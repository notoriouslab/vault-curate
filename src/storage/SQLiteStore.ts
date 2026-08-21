/**
 * SQLiteStore — typed high-level facade over sql.js for vault-curate.
 *
 * Design rationale: see openspec/changes/004-vault-curate-rebrand/design.md D2.
 *
 * Key contract:
 *   - All SQL is encapsulated here; consumers MUST NOT touch raw db.exec.
 *   - Float32Array <-> BLOB via vecCodec.
 *   - FTS5 input is pre-tokenised via cjkTokenize (matches index + query side).
 *   - Persistence is debounced: every 100 mutations or 30s idle triggers save.
 */
import type { Database } from 'sql.js';
import { openDb, exportDb } from './sqlJsRuntime';
import { applySchema, pruneOrphanChunks } from './schema';
import { vecToBlob, blobToVec } from './vecCodec';
import { l2normalize } from '../utils/l2normalize';
import { composeNoteVec } from '../utils/composeVec';
import {
    tokenizeForBM25,
    buildBM25Index,
    searchBM25Index,
    type BM25Doc,
    type BM25Index,
} from './bm25';

// ─── Types (mirror design.md D2 + tasks.md Task 2.5) ──────────────────────────

export type NoteRecord = {
    path: string;
    mtime: number;
    title: string;
    description: string | null;
    tier: 'hot' | 'cold' | null;
    bodyVec: Float32Array;
    bodyDim: number;
    indexedAt: number;
    /** Description embedding (007 D4). null = no / too-short description. */
    descVec: Float32Array | null;
};

export type ChunkRecord = {
    notePath: string;
    chunkIndex: number;
    content: string;
    vec: Float32Array;
};

export type BM25Hit = {
    notePath: string;
    chunkIndex: number;
    bm25Score: number;
};

export type ChunkRawRow = {
    notePath: string;
    chunkIndex: number;
    vec: Uint8Array;
};

// ─── Persistence hooks (injected by main.ts) ──────────────────────────────────

export type PersistAdapter = {
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
};

// ─── Store ────────────────────────────────────────────────────────────────────

const MUTATION_THRESHOLD = 100;
const IDLE_FLUSH_MS = 30_000;

export class SQLiteStore {
    private db!: Database;
    private mutationCount = 0;
    private idleTimer: number | null = null;
    /** Monotonic mutation counter (never reset, unlike mutationCount) —
     *  cheap cache-invalidation key for consumers that derive expensive
     *  structures from the index (009 k-NN graph memo). */
    private revision = 0;
    private flushInFlight: Promise<void> | null = null;
    /** 020: the revision whose bytes are known to be on disk. `revision`
     *  itself is the in-memory truth; the gap between them is "dirty".
     *  Starts at -1 (nothing written yet, and revision 0 is a real state). */
    private lastWrittenRevision = -1;
    private disposed = false;
    // 007 D5: desc/body blend weight for composed note vectors. Injected by
    // main.ts from settings.descWeight (store must not depend on plugin
    // settings directly). 0.5 = offline alpha-scan pick.
    private composeAlpha = 0.5;
    // 007 D9: lazily built inverted index for searchBM25. Reset to null on
    // any mutation that changes the corpus (chunks or descriptions);
    // setDescVec deliberately does NOT reset it — desc TEXT is unchanged.
    private bm25Index: BM25Index | null = null;
    /** In-flight background BM25 build; concurrent warms coalesce onto it. */
    private bm25WarmTask: Promise<void> | null = null;

    private constructor(
        private readonly adapter: PersistAdapter,
        private readonly dbPath: string,
    ) {}

    /** True once dispose() has been called. Mutation methods become no-ops. */
    get isDisposed(): boolean {
        return this.disposed;
    }

    /** 007 D5: update the desc/body blend weight (settings.descWeight).
     *  Defense in depth vs main.ts's loadSettings sanitize: NaN slips through
     *  Math.max/Math.min clamps (Math.min(NaN, 1) === NaN) and would poison
     *  every composed vector — reject non-finite here too. */
    setComposeAlpha(alpha: number): void {
        if (!Number.isFinite(alpha)) return; // keep current (default 0.5)
        this.composeAlpha = Math.max(0, Math.min(1, alpha));
    }

    /** Factory: open existing db file or create fresh, apply schema.
     *  015: `opts.readOnly` opens a query-only store — the in-memory DB
     *  still runs schema DDL / migration / prune (they never leave RAM),
     *  but nothing is ever written back to disk (mobile reads the
     *  desktop-built index; a single writer keeps iCloud conflict-free). */
    static async open(
        adapter: PersistAdapter,
        dbPath: string,
        wasmBinary: Uint8Array,
        opts?: { readOnly?: boolean },
    ): Promise<SQLiteStore> {
        const store = new SQLiteStore(adapter, dbPath);
        store.readOnly = opts?.readOnly ?? false;
        const exists = await adapter.exists(dbPath);
        const bytes = exists ? await adapter.read(dbPath) : null;
        store.db = await openDb(bytes, wasmBinary);
        applySchema(store.db);
        // Clear chunks left behind by pre-fix deletes/renames (and self-heal any
        // future leak). Only touches the store when it actually removed rows.
        const pruned = pruneOrphanChunks(store.db);
        if (pruned > 0) {
            console.debug(`vault-curate: pruned ${pruned} orphan chunk(s)`);
            store.bm25Index = null; // corpus shrank
            if (!store.readOnly) store.touch();
        }
        return store;
    }

    /** 015: write ignored in read-only mode — warn once per method so a
     *  miswired caller is visible without spamming the console. */
    private refuseWrite(method: string): boolean {
        if (!this.readOnly) return false;
        if (!this.warnedWrites.has(method)) {
            this.warnedWrites.add(method);
            console.warn(`vault-curate: write ignored (read-only store): ${method}`);
        }
        return true;
    }

    // ─── Notes ────────────────────────────────────────────────────────────────

    upsertNote(note: NoteRecord): void {
        if (this.disposed) return;
        if (this.refuseWrite("upsertNote")) return;
        this.db.run(
            `INSERT OR REPLACE INTO notes
             (path, mtime, title, description, tier, body_vec, body_dim, indexed_at, desc_vec)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                note.path,
                note.mtime,
                note.title,
                note.description,
                note.tier,
                vecToBlob(note.bodyVec),
                note.bodyDim,
                note.indexedAt,
                note.descVec ? vecToBlob(note.descVec) : null,
            ],
        );
        this.bm25Index = null; // description may have changed (D9)
        this.touch();
    }

    getNote(path: string): NoteRecord | null {
        const res = this.db.exec(
            `SELECT path, mtime, title, description, tier, body_vec, body_dim, indexed_at, desc_vec
             FROM notes WHERE path = ?`,
            [path],
        );
        if (res.length === 0 || res[0].values.length === 0) return null;
        const row = res[0].values[0];
        return {
            path: row[0] as string,
            mtime: row[1] as number,
            title: row[2] as string,
            description: row[3] as string | null,
            tier: row[4] as 'hot' | 'cold' | null,
            // Normalized at the read boundary (007 Task 2.5): body_vec is a
            // mean-pool with norm < 1 for multi-chunk notes; rankers assume
            // unit vectors (dot = cosine). See utils/l2normalize.ts.
            bodyVec: l2normalize(blobToVec(row[5] as Uint8Array)),
            bodyDim: row[6] as number,
            indexedAt: row[7] as number,
            descVec: row[8] ? blobToVec(row[8] as Uint8Array) : null,
        };
    }

    /**
     * Composed ranking vector for one note (007 D4/A1):
     * l2norm(alpha·descVec + (1−alpha)·l2norm(bodyVec)); no desc → l2norm(body).
     * Query-side counterpart of getAllNotesLight().noteVec — use THIS (not
     * getNote().bodyVec) wherever a similarity query vector is needed.
     */
    getNoteVec(path: string): Float32Array | null {
        const res = this.db.exec(
            'SELECT body_vec, desc_vec FROM notes WHERE path = ?',
            [path],
        );
        if (res.length === 0 || res[0].values.length === 0) return null;
        const row = res[0].values[0];
        if (row[0] == null) return null;
        return composeNoteVec(
            blobToVec(row[0] as Uint8Array),
            row[1] ? blobToVec(row[1] as Uint8Array) : null,
            this.composeAlpha,
        );
    }

    deleteNote(path: string): void {
        if (this.disposed) return;
        if (this.refuseWrite("deleteNote")) return;
        // Chunks must go explicitly. The schema declares ON DELETE CASCADE but
        // sql.js keeps foreign_keys OFF, so it never fires — and enabling the
        // pragma would make upsertNote's INSERT OR REPLACE cascade a note's
        // chunks away on every tier flip. See pruneOrphanChunks() in schema.ts.
        this.db.run('DELETE FROM chunks WHERE note_path = ?', [path]);
        this.db.run('DELETE FROM notes WHERE path = ?', [path]);
        this.bm25Index = null; // corpus shrank (D9)
        this.touch();
    }

    // ─── desc_vec backfill (007 D4 — self-healing upgrade path) ──────────────
    // Schema v3 adds the column but existing rows stay NULL, and unchanged
    // mtime means they never re-index. These helpers let the indexer embed
    // JUST the descriptions (no chunk re-embed). No version meta needed: the
    // pending query is its own termination condition.

    countDescBackfillPending(minDescChars: number): number {
        const res = this.db.exec(
            `SELECT COUNT(*) FROM notes
             WHERE description IS NOT NULL AND length(description) >= ?
               AND desc_vec IS NULL AND body_vec IS NOT NULL`,
            [minDescChars],
        );
        return res.length > 0 ? (res[0].values[0][0] as number) : 0;
    }

    listDescBackfillPending(minDescChars: number): Array<{ path: string; description: string }> {
        const res = this.db.exec(
            `SELECT path, description FROM notes
             WHERE description IS NOT NULL AND length(description) >= ?
               AND desc_vec IS NULL AND body_vec IS NOT NULL`,
            [minDescChars],
        );
        if (res.length === 0) return [];
        return res[0].values.map(row => ({
            path: row[0] as string,
            description: row[1] as string,
        }));
    }

    setDescVec(path: string, vec: Float32Array): void {
        if (this.disposed) return;
        if (this.refuseWrite("setDescVec")) return;
        this.db.run('UPDATE notes SET desc_vec = ? WHERE path = ?', [vecToBlob(vec), path]);
        this.touch();
    }

    // ─── Chunks ───────────────────────────────────────────────────────────────

    upsertChunks(notePath: string, chunks: ChunkRecord[]): void {
        if (this.disposed) return;
        if (this.refuseWrite("upsertChunks")) return;
        // Replace strategy: delete existing chunks for this note, insert new.
        this.db.run('DELETE FROM chunks WHERE note_path = ?', [notePath]);
        const insertChunk = this.db.prepare(
            `INSERT INTO chunks (note_path, chunk_index, content, vec)
             VALUES (?, ?, ?, ?)`,
        );
        try {
            for (const c of chunks) {
                insertChunk.run([c.notePath, c.chunkIndex, c.content, vecToBlob(c.vec)]);
            }
        } finally {
            insertChunk.free();
        }
        this.bm25Index = null; // chunk contents changed (D9)
        this.touch();
    }

    getChunks(notePath: string): ChunkRecord[] {
        const res = this.db.exec(
            `SELECT note_path, chunk_index, content, vec FROM chunks
             WHERE note_path = ? ORDER BY chunk_index ASC`,
            [notePath],
        );
        if (res.length === 0) return [];
        return res[0].values.map((row) => ({
            notePath: row[0] as string,
            chunkIndex: row[1] as number,
            content: row[2] as string,
            vec: blobToVec(row[3] as Uint8Array),
        }));
    }

    countChunks(): number {
        const res = this.db.exec(`SELECT COUNT(*) FROM chunks`);
        if (res.length === 0 || res[0].values.length === 0) return 0;
        return res[0].values[0][0] as number;
    }

    getAllChunksRaw(): ChunkRawRow[] {
        const res = this.db.exec(
            `SELECT note_path, chunk_index, vec FROM chunks`,
        );
        if (res.length === 0) return [];
        return res[0].values.map((row) => ({
            notePath: row[0] as string,
            chunkIndex: row[1] as number,
            vec: row[2] as Uint8Array,
        }));
    }

    /** 019 D2: every indexed path, no vector decode. The reconcile pass only
     *  needs keys, and getAllBodyVecs() would (a) decode every body vector
     *  just to throw them away and (b) hide rows whose body_vec is NULL —
     *  legacy rows that then survive even a manual Update index. */
    listNotePaths(): string[] {
        const res = this.db.exec('SELECT path FROM notes');
        if (res.length === 0) return [];
        return res[0].values.map((row) => row[0] as string);
    }

    getAllBodyVecs(): Map<string, Float32Array> {
        const out = new Map<string, Float32Array>();
        const res = this.db.exec('SELECT path, body_vec FROM notes WHERE body_vec IS NOT NULL');
        if (res.length === 0) return out;
        for (const row of res[0].values) {
            out.set(row[0] as string, blobToVec(row[1] as Uint8Array));
        }
        return out;
    }

    getAllTitles(): Map<string, string> {
        const out = new Map<string, string>();
        const res = this.db.exec('SELECT path, title FROM notes');
        if (res.length === 0) return out;
        for (const row of res[0].values) {
            out.set(row[0] as string, (row[1] as string) ?? '');
        }
        return out;
    }

    /**
     * Batch load all notes' light projection (path/title/tier/noteVec) in one
     * SELECT. Used by Discover / Find Similar to avoid the per-note `getNote()`
     * SELECT inside hot cosine loops (the diff between this and N×`getNote()`
     * is roughly 100x on a 10k-vault Discover render). `noteVec` is the
     * composed + unit-norm ranking vector (007 D4) — same semantics as
     * getNoteVec().
     */
    getAllNotesLight(): Array<{ path: string; title: string; tier: 'hot' | 'cold' | null; noteVec: Float32Array }> {
        const res = this.db.exec(
            'SELECT path, title, tier, body_vec, desc_vec FROM notes WHERE body_vec IS NOT NULL',
        );
        if (res.length === 0) return [];
        const out: Array<{ path: string; title: string; tier: 'hot' | 'cold' | null; noteVec: Float32Array }> = [];
        for (const row of res[0].values) {
            const tierRaw = row[2] as string | null;
            const tier: 'hot' | 'cold' | null = tierRaw === 'cold' ? 'cold' : tierRaw === 'hot' ? 'hot' : null;
            out.push({
                path: row[0] as string,
                title: (row[1] as string) ?? '',
                tier,
                // Composed + unit-norm ranking vector (007 D4/A1). Renamed
                // from `bodyVec` so tsc walks every consumer through the
                // semantics change (mean-pool body → desc-weighted blend).
                noteVec: composeNoteVec(
                    blobToVec(row[3] as Uint8Array),
                    row[4] ? blobToVec(row[4] as Uint8Array) : null,
                    this.composeAlpha,
                ),
            });
        }
        return out;
    }

    // ─── BM25 search (pure TypeScript, see bm25.ts for rationale) ─────────────

    /** Gather the BM25 corpus: all chunks + one desc virtual doc per note. */
    private collectBM25Docs(): BM25Doc[] {
        const docs: BM25Doc[] = [];
        const res = this.db.exec(
            `SELECT note_path, chunk_index, content FROM chunks`,
        );
        if (res.length > 0) {
            for (const row of res[0].values) {
                docs.push({
                    id: `${row[0] as string}#${row[1] as number}`,
                    tokens: tokenizeForBM25(row[2] as string),
                });
            }
        }
        // 007 D7: descriptions join the BM25 pool as one virtual doc per note
        // (chunkIndex -1 convention). Rare terms that live only in a
        // description become keyword-searchable. Sole consumer (searchHybrid)
        // max-pools per notePath and ignores chunkIndex — verified safe.
        const descRes = this.db.exec(
            "SELECT path, description FROM notes WHERE description IS NOT NULL AND description != ''",
        );
        if (descRes.length > 0) {
            for (const row of descRes[0].values) {
                docs.push({
                    id: `${row[0] as string}#-1`,
                    tokens: tokenizeForBM25(row[1] as string),
                });
            }
        }
        return docs;
    }

    /**
     * Build (or reuse) the inverted index (007 D9). Building tokenizes the
     * whole corpus (~2-3s on a 10k-doc vault, synchronous) — the indexer
     * calls this at the end of rebuild()/update() so searches almost never
     * pay it; mutations since the last build reset the cache (see touchIndex
     * call sites).
     */
    warmBM25Index(): void {
        if (this.disposed) return;
        if (this.bm25Index) return;
        this.bm25Index = buildBM25Index(this.collectBM25Docs());
    }

    /** Whether the BM25 index is currently built (011): relatedness fusion
     *  must NEVER trigger the synchronous first build from the passive
     *  file-open path — it checks this and degrades to pure cosine while
     *  cold (the background sliced warm below closes the gap). */
    isBM25Warm(): boolean {
        return this.bm25Index !== null;
    }

    /** Time-sliced background BM25 build (011 perf follow-up): fusion
     *  quality must not be a hidden state machine of "has the user
     *  searched since the last save" — dogfood caught Discover flipping
     *  smart/dumb with warm/cold. Yields to the event loop every SLICE
     *  docs so the UI stays responsive; a mutation landing mid-build
     *  discards the result (the next schedule retries); concurrent
     *  callers coalesce onto one task. */
    async warmBM25IndexAsync(): Promise<void> {
        if (this.disposed || this.bm25Index) return;
        if (this.bm25WarmTask) return this.bm25WarmTask;
        this.bm25WarmTask = this.buildBM25Sliced().finally(() => {
            this.bm25WarmTask = null;
        });
        return this.bm25WarmTask;
    }

    private async buildBM25Sliced(): Promise<void> {
        const startRevision = this.revision;
        const SLICE = 150;
        const yieldToUi = () => new Promise<void>((r) => window.setTimeout(r, 0));

        const docs: BM25Doc[] = [];
        const res = this.db.exec(
            `SELECT note_path, chunk_index, content FROM chunks`,
        );
        if (res.length > 0) {
            const rows = res[0].values;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                docs.push({
                    id: `${row[0] as string}#${row[1] as number}`,
                    tokens: tokenizeForBM25(row[2] as string),
                });
                if ((i + 1) % SLICE === 0) {
                    await yieldToUi();
                    // dispose() may close the db while we were yielding —
                    // touching it again would throw into a void'd promise
                    // (red-team F1 / audit W2).
                    if (this.disposed) return;
                }
            }
        }
        if (this.disposed) return;
        const descRes = this.db.exec(
            "SELECT path, description FROM notes WHERE description IS NOT NULL AND description != ''",
        );
        if (descRes.length > 0) {
            const rows = descRes[0].values;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                docs.push({
                    id: `${row[0] as string}#-1`,
                    tokens: tokenizeForBM25(row[1] as string),
                });
                if ((i + 1) % SLICE === 0) {
                    await yieldToUi();
                    if (this.disposed) return;
                }
            }
        }

        if (this.disposed || this.revision !== startRevision || this.bm25Index) return;
        this.bm25Index = buildBM25Index(docs);
    }

    /**
     * BM25 search over chunks.content + description virtual docs.
     *
     * Implementation note: sql.js 1.14.1 doesn't ship FTS5, so BM25 runs in
     * TypeScript over a prebuilt inverted index (007 D9 — previously every
     * query re-tokenized the corpus, ~2s per search on a 10k-doc vault; now
     * <1ms after the first build).
     *
     * @param query Raw query string. Tokenisation happens internally.
     */
    searchBM25(query: string, limit: number): BM25Hit[] {
        const queryTokens = tokenizeForBM25(query);
        if (queryTokens.length === 0) return [];

        this.warmBM25Index();
        if (!this.bm25Index) return [];
        const ranked = searchBM25Index(this.bm25Index, queryTokens, limit);

        return ranked.map((hit) => {
            const hashIdx = hit.id.lastIndexOf('#');
            return {
                notePath: hit.id.slice(0, hashIdx),
                chunkIndex: Number(hit.id.slice(hashIdx + 1)),
                bm25Score: hit.score,
            };
        });
    }

    // ─── Meta ─────────────────────────────────────────────────────────────────

    getMeta(key: string): string | null {
        const res = this.db.exec('SELECT value FROM meta WHERE key = ?', [key]);
        if (res.length === 0 || res[0].values.length === 0) return null;
        return res[0].values[0][0] as string;
    }

    setMeta(key: string, value: string): void {
        if (this.disposed) return;
        if (this.refuseWrite("setMeta")) return;
        this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
        this.touch();
    }

    // ─── Bulk operations ──────────────────────────────────────────────────────

    /** Provider switch: clear all indexed data but preserve schema + meta.schema_version. */
    clearAllData(): void {
        if (this.disposed) return;
        if (this.refuseWrite("clearAllData")) return;
        this.bm25Index = null; // corpus wiped (D9)
        // Wrap multi-statement clear in a transaction so a crash mid-clear
        // leaves notes + chunks consistent (no orphaned chunks rows). If exec
        // throws partway, ROLLBACK best-effort so the next mutation doesn't
        // get rejected by an open transaction.
        try {
            this.db.exec(`
                BEGIN;
                DELETE FROM chunks;
                DELETE FROM notes;
                DELETE FROM meta WHERE key IN (
                    'embedding_provider',
                    'embedding_model_id',
                    'embedding_dim',
                    'last_indexed_at'
                );
                COMMIT;
            `);
        } catch (err) {
            try { this.db.exec('ROLLBACK'); } catch { /* best-effort */ }
            throw err;
        }
        this.touch(/*force*/ true);
    }

    // ─── Persistence (debounced) ──────────────────────────────────────────────

    /** Changes whenever any index mutation lands; equal revisions imply
     *  identical index content (within one store instance). */
    getRevision(): number {
        return this.revision;
    }

    private touch(force = false): void {
        this.revision++;
        this.mutationCount++;
        if (this.idleTimer) window.clearTimeout(this.idleTimer);
        if (force || this.mutationCount >= MUTATION_THRESHOLD) {
            void this.flush();
        } else {
            this.idleTimer = window.setTimeout(() => void this.flush(), IDLE_FLUSH_MS);
        }
    }

    /** Force-flush to disk. Returns when bytes are persisted. */
    /** 015: read-only mode (set via open() opts) — flush becomes a no-op
     *  so the on-disk index can never be modified by this instance. */
    private readOnly = false;
    /** Write methods already warned about in read-only mode. */
    private warnedWrites = new Set<string>();

    /** The persist step itself: export the in-memory DB, hand the bytes to the
     *  adapter. Deliberately does NOT check `disposed` — dispose()'s farewell
     *  write has to get through after that flag is already set, and routing it
     *  through flush() is exactly what silently turned it into a no-op. */
    private async writeNow(): Promise<void> {
        if (this.idleTimer) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        // Capture the revision the bytes represent. exportDb is synchronous,
        // so nothing can mutate between these two lines — the watermark and
        // the bytes are the same instant by construction.
        const exported = this.revision;
        const bytes = exportDb(this.db);
        await this.adapter.write(this.dbPath, bytes);
        if (exported > this.lastWrittenRevision) this.lastWrittenRevision = exported;
        this.mutationCount = 0;
    }

    /**
     * Resolve only once the caller's own state is on disk (020).
     *
     * The pre-020 version returned the in-flight write's promise whenever one
     * existed. That write's bytes were exported when IT started, so a burst of
     * mutations behind it never reached disk and `await flush()` still
     * reported success — measured: 300 rows in memory, 100 on disk, and a
     * manual "Update index" over 2600 deletions left the on-disk index at the
     * 100-deletion mark. Callers (rebuild/update tails, the mobile handoff)
     * read this as "persisted".
     *
     * The loop is bounded, and that bound is what keeps a 73MB index from
     * being written thousands of times: any export captures the CURRENT
     * revision, which is >= every waiting caller's target, so one catch-up
     * write satisfies all of them at once. Worst case per caller is
     * "wait out a stale write, then one more" — asserted as a write-count
     * ceiling in flushWatermark.test.ts, not left to reasoning.
     */
    async flush(): Promise<void> {
        if (this.readOnly) return;
        if (this.disposed) return;
        const target = this.revision;
        while (this.lastWrittenRevision < target) {
            if (this.flushInFlight) {
                // May or may not cover `target` — re-check after it lands.
                await this.flushInFlight;
                continue;
            }
            if (this.disposed) return; // disposed while we waited
            this.flushInFlight = (async () => {
                try {
                    await this.writeNow();
                } finally {
                    this.flushInFlight = null;
                }
            })();
            await this.flushInFlight;
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        // Flag first, before any await: every mutation method keys its refusal
        // off `disposed`, and dispose() is now async all the way down — leaving
        // the flag unset across the awaits below would let writes land in a DB
        // that is on its way out.
        this.disposed = true;
        // Drop the pending idle flush: we are about to write the same bytes
        // ourselves. Not load-bearing for correctness — a timer that fired
        // during the awaits below would reach flush(), which bails on either
        // the `disposed` flag above or the in-flight write it would find. Both
        // of those were verified by mutation-testing the timer ordering: the
        // test could not be made to fail, so it was deleted rather than kept
        // as a false green.
        if (this.idleTimer) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        // A write may already be on its way out (mutationCount crossed the
        // threshold moments ago). Let it land before we close the DB under it.
        if (this.flushInFlight) await this.flushInFlight;
        // Farewell write for anything still only in memory. Uses writeNow()
        // rather than flush() so the `disposed` guard above doesn't eat it.
        // 020: the condition MUST be the revision watermark, NEVER
        // mutationCount — a write that exported an older snapshot resets the
        // count to 0, so this guard used to skip the farewell write for
        // exactly the mutations that had not been persisted (measured on a
        // real vault: 2500 rows lost on a plugin reload).
        if (!this.readOnly && this.lastWrittenRevision < this.revision) await this.writeNow();
        this.db.close();
    }
}
