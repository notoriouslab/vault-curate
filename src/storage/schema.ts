/**
 * SQLite schema for vault-curate v1.0.0.
 *
 * See openspec/changes/004-vault-curate-rebrand/design.md D2 for the full
 * rationale. Highlights:
 *   - notes.body_vec = mean-pool of chunks vectors only (NO title, NO description).
 *   - chunks.chunk_index is 0-based within a note.
 *   - BM25 is computed in TypeScript (src/storage/bm25.ts) over chunks.content,
 *     NOT via an FTS5 virtual table — sql.js 1.14.1 ships without FTS5 compiled
 *     in. See Phase 2 retry log (G3 R5) for the rationale. API contract on
 *     SQLiteStore.searchBM25 is unchanged.
 *   - meta is a key-value store for schema_version, embedding_model_id,
 *     embedding_provider, embedding_dim, last_indexed_at, weight_bm25,
 *     weight_semantic, weight_fuzzy, last_migration_from.
 */
import type { Database } from 'sql.js';

export const SCHEMA_VERSION = '3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notes (
    path        TEXT PRIMARY KEY,
    mtime       INTEGER NOT NULL,
    title       TEXT,
    description TEXT,
    tier        TEXT,
    body_vec    BLOB,
    body_dim    INTEGER NOT NULL,
    indexed_at  INTEGER NOT NULL,
    desc_vec    BLOB
);

-- NOTE: the ON DELETE CASCADE below is INERT and must stay that way.
-- sql.js defaults foreign_keys to OFF, so it never fires; chunk cleanup is
-- done explicitly in SQLiteStore.deleteNote() plus the pruneOrphanChunks()
-- sweep. Do NOT "fix" this by enabling the pragma — see pruneOrphanChunks()
-- for the measurement showing why that silently destroys the index.
CREATE TABLE IF NOT EXISTS chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    note_path    TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    content      TEXT NOT NULL,
    vec          BLOB NOT NULL,
    UNIQUE(note_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(note_path);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS synonyms (
    term      TEXT NOT NULL,
    expansion TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synonyms_term ON synonyms(term);
`;

/**
 * Apply schema (idempotent) + run forward migrations.
 *
 * Migration history:
 *   - 1 → 2: introduce `bootstrapped` sticky meta flag. If the user already
 *     has a successful index (last_indexed_at present), backfill bootstrapped
 *     so auto-index on file events still fires after upgrade.
 *   - 2 → 3: add `notes.desc_vec BLOB` (007 D4 — description embedding for
 *     weighted note-vector composition). Existing rows keep NULL until the
 *     next re-index of that note.
 */

/**
 * PRAGMA-guarded ALTER: adds `desc_vec` only when the column is missing.
 * Idempotent, so every migration path (1→3, 2→3, unknown-version normalize)
 * can call it without risking a duplicate-column throw.
 */
function ensureDescVecColumn(db: Database): void {
    const info = db.exec("PRAGMA table_info(notes)");
    const hasCol = info.length > 0
        && info[0].values.some(row => row[1] === 'desc_vec');
    if (!hasCol) {
        db.exec('ALTER TABLE notes ADD COLUMN desc_vec BLOB');
    }
}

export function applySchema(db: Database): void {
    db.exec(SCHEMA_SQL);

    const existing = db.exec("SELECT value FROM meta WHERE key='schema_version'");
    const currentVersion = existing.length > 0 && existing[0].values.length > 0
        ? String(existing[0].values[0][0])
        : null;

    // Helper: backfill `bootstrapped` for any path where the user already has
    // a successful index but is missing the sticky auto-index flag.
    const backfillBootstrapped = () => {
        const lastIndexed = db.exec("SELECT value FROM meta WHERE key='last_indexed_at'");
        if (lastIndexed.length > 0 && lastIndexed[0].values.length > 0) {
            db.run("INSERT OR REPLACE INTO meta(key, value) VALUES('bootstrapped', '1')");
        }
    };

    if (currentVersion === null) {
        // Fresh install OR pre-existing SQLite db that never got schema_version
        // (dev rough patches before Phase 2 commit, or corruption). The latter
        // may predate desc_vec — CREATE TABLE IF NOT EXISTS won't add columns
        // to an existing table, so guard-ALTER here too.
        ensureDescVecColumn(db);
        db.run("INSERT INTO meta(key, value) VALUES('schema_version', ?)", [SCHEMA_VERSION]);
        backfillBootstrapped();
        return;
    }

    if (currentVersion === '1') {
        backfillBootstrapped();
        ensureDescVecColumn(db);
        db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [SCHEMA_VERSION]);
        return;
    }

    if (currentVersion === '2') {
        ensureDescVecColumn(db);
        db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [SCHEMA_VERSION]);
        return;
    }

    if (currentVersion === SCHEMA_VERSION) {
        // No-op: at the latest version.
        return;
    }

    // Future-version downgrade guard: if currentVersion looks numerically
    // greater than SCHEMA_VERSION, the user downgraded from a newer release
    // whose db structure we don't understand. Don't normalize — that would
    // erase the version marker and we might INSERT against incompatible v3+
    // schema. Log and bail; the caller will see surface errors organically.
    const currentNum = parseInt(currentVersion, 10);
    const latestNum = parseInt(SCHEMA_VERSION, 10);
    if (Number.isFinite(currentNum) && currentNum > latestNum) {
        console.warn(
            `vault-curate: schema_version "${currentVersion}" is newer than this plugin (${SCHEMA_VERSION}). ` +
            `Refusing to downgrade — upgrade the plugin or wipe the db to continue.`,
        );
        return;
    }

    // Unknown / corrupted schema_version (e.g. "v1", "banana", "1.0", empty
    // string). Don't crash — log + force-normalise to latest + backfill any
    // missing sticky flags so the plugin stays usable.
    console.warn(
        `vault-curate: unrecognised schema_version "${currentVersion}" — resetting to ${SCHEMA_VERSION}`,
    );
    backfillBootstrapped();
    ensureDescVecColumn(db);
    db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [SCHEMA_VERSION]);
}

/**
 * Delete chunk rows whose note row no longer exists, returning how many went.
 *
 * Why this is a manual sweep and not the schema's ON DELETE CASCADE:
 *
 *   1. sql.js 1.14.1 defaults `foreign_keys` to OFF (measured: `PRAGMA
 *      foreign_keys` reads 0 on a fresh Database), so the CASCADE declared on
 *      chunks.note_path never fires. deleteNote() removed only the notes row
 *      and left the chunks behind — both the delete and the rename path, since
 *      renameNote() deletes the old path too.
 *
 *   2. Turning the pragma ON is NOT the fix, it is an index-destroying change.
 *      upsertNote() uses INSERT OR REPLACE, and SQLite's REPLACE deletes the
 *      conflicting row before inserting the new one, which cascades that
 *      note's chunks away. Measured on sql.js 1.14.1 with the pragma ON: a
 *      2-chunk note went to 0 chunks after one REPLACE (a plain UPDATE was
 *      unaffected). The tier-update paths in indexer.ts call upsertNote
 *      WITHOUT re-inserting chunks, so every Hot/Cold flip would silently
 *      empty that note's chunks and drop it out of BM25 and semantic search
 *      with no error surfaced.
 *
 * Runs on every open so pre-fix orphans get cleared and any future leak
 * self-heals. Caller invalidates the BM25 index when this returns non-zero:
 * the corpus is built from chunks, so orphans inflate N and steal candidate
 * slots (measured on a real 8,383-chunk vault: 85 orphans, 1.01%).
 */
export function pruneOrphanChunks(db: Database): number {
    const res = db.exec(
        `SELECT COUNT(*) FROM chunks
         WHERE NOT EXISTS (SELECT 1 FROM notes WHERE notes.path = chunks.note_path)`,
    );
    const orphans = res.length > 0 && res[0].values.length > 0
        ? Number(res[0].values[0][0])
        : 0;
    if (orphans === 0) return 0; // don't dirty the store on a clean open
    db.run(
        `DELETE FROM chunks
         WHERE NOT EXISTS (SELECT 1 FROM notes WHERE notes.path = chunks.note_path)`,
    );
    return orphans;
}
