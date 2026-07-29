/**
 * Orphan chunk cleanup: deleteNote / renameNote used to leave chunk rows behind
 * because the schema's ON DELETE CASCADE never fires under sql.js.
 *
 * The last two tests are regression LOCKS on the reason the pragma stays off.
 * If someone "fixes" the inert CASCADE by enabling foreign_keys, they break the
 * index silently — these tests document the mechanism so that change gets
 * caught here instead of in a user's vault.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { applySchema, pruneOrphanChunks } from '../src/storage/schema';

const vec = new Float32Array([1, 0]);
const wasmPath = 'node_modules/sql.js/dist/sql-wasm.wasm';

let SQL: SqlJsStatic;
beforeAll(async () => {
    SQL = await initSqlJs();
});

const memAdapter = (bytes: Uint8Array | null = null): PersistAdapter => ({
    read: async () => bytes,
    write: async () => { /* in-memory */ },
    exists: async () => bytes !== null,
});

const openStore = async (bytes: Uint8Array | null = null): Promise<SQLiteStore> => {
    const wasm = readFileSync(wasmPath);
    return SQLiteStore.open(memAdapter(bytes), 'test.db', new Uint8Array(wasm));
};

const seedNote = (store: SQLiteStore, path: string, content: string): void => {
    store.upsertNote({
        path, mtime: 1, title: path, description: null, tier: 'hot',
        bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks(path, [
        { notePath: path, chunkIndex: 0, content, vec },
        { notePath: path, chunkIndex: 1, content: `${content} 續段`, vec },
    ]);
};

describe('deleteNote 連帶清 chunks', () => {
    it('刪筆記後該筆記的 chunks 歸零，其他筆記不受影響', async () => {
        const store = await openStore();
        seedNote(store, 'a.md', '甲筆記講登山裝備');
        seedNote(store, 'b.md', '乙筆記講咖啡烘焙');
        expect(store.countChunks()).toBe(4);

        store.deleteNote('a.md');

        expect(store.countChunks()).toBe(2);
        expect(store.searchBM25('登山裝備', 10)).toHaveLength(0);
        expect(store.searchBM25('咖啡烘焙', 10).length).toBeGreaterThan(0);
    });

    it('rename 路徑（deleteNote(oldPath) + 重建）不留舊 path 的 chunks', async () => {
        const store = await openStore();
        seedNote(store, 'old.md', '同一篇內容講程式重構');
        // renameNote() does exactly this: drop the old path, index the new one.
        store.deleteNote('old.md');
        seedNote(store, 'new.md', '同一篇內容講程式重構');

        expect(store.countChunks()).toBe(2);
        const hits = store.searchBM25('程式重構', 10);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every(h => h.notePath === 'new.md')).toBe(true);
    });
});

describe('pruneOrphanChunks', () => {
    it('清掉無主 chunks、回傳筆數、保留正常 chunks', () => {
        const db = new SQL.Database();
        applySchema(db);
        db.run("INSERT INTO notes(path, mtime, body_dim, indexed_at) VALUES ('live.md', 1, 2, 1)");
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('live.md', 0, 'x', X'00')");
        // Orphans: exactly what the pre-fix deleteNote left behind.
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('gone.md', 0, 'y', X'00')");
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('gone.md', 1, 'z', X'00')");

        expect(pruneOrphanChunks(db)).toBe(2);

        const rows = db.exec('SELECT note_path FROM chunks');
        expect(rows[0].values.map(r => r[0])).toEqual(['live.md']);
    });

    it('沒有孤兒時回 0（呼叫端才不會白 touch 造成多餘存檔）', () => {
        const db = new SQL.Database();
        applySchema(db);
        db.run("INSERT INTO notes(path, mtime, body_dim, indexed_at) VALUES ('live.md', 1, 2, 1)");
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('live.md', 0, 'x', X'00')");

        expect(pruneOrphanChunks(db)).toBe(0);
        expect(pruneOrphanChunks(db)).toBe(0); // idempotent
    });

    it('open() 會清掉舊版留下的孤兒', async () => {
        // Build a db in the pre-fix state: note row deleted, chunks left.
        const seed = new SQL.Database();
        applySchema(seed);
        seed.run("INSERT INTO notes(path, mtime, body_dim, indexed_at) VALUES ('ghost.md', 1, 2, 1)");
        seed.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('ghost.md', 0, 'x', X'00')");
        seed.run("DELETE FROM notes WHERE path = 'ghost.md'"); // old deleteNote: notes only
        expect(seed.exec('SELECT COUNT(*) FROM chunks')[0].values[0][0]).toBe(1);
        const bytes = seed.export();

        const store = await openStore(bytes);

        expect(store.countChunks()).toBe(0);
    });
});

describe('回歸鎖：為什麼 foreign_keys 必須保持 OFF', () => {
    it('sql.js 預設 foreign_keys = OFF，所以 schema 的 CASCADE 是死的', () => {
        const db = new SQL.Database();
        expect(db.exec('PRAGMA foreign_keys')[0].values[0][0]).toBe(0);

        applySchema(db);
        db.run("INSERT INTO notes(path, mtime, body_dim, indexed_at) VALUES ('a.md', 1, 2, 1)");
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('a.md', 0, 'x', X'00')");
        db.run("DELETE FROM notes WHERE path = 'a.md'");

        // CASCADE did NOT fire — this orphan is the bug pruneOrphanChunks cleans.
        expect(db.exec('SELECT COUNT(*) FROM chunks')[0].values[0][0]).toBe(1);
    });

    it('開 foreign_keys 會讓 upsertNote 的 INSERT OR REPLACE 清空該筆記 chunks', () => {
        const db = new SQL.Database();
        db.run('PRAGMA foreign_keys = ON');
        applySchema(db);
        db.run("INSERT INTO notes(path, mtime, body_dim, indexed_at) VALUES ('a.md', 1, 2, 1)");
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('a.md', 0, 'x', X'00')");
        db.run("INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES ('a.md', 1, 'y', X'00')");

        // What the tier-update paths do: upsertNote with no chunk re-insert.
        db.run(
            `INSERT OR REPLACE INTO notes (path, mtime, tier, body_dim, indexed_at)
             VALUES ('a.md', 1, 'cold', 2, 1)`,
        );

        // REPLACE deletes-then-inserts, so the CASCADE wipes the chunks. This is
        // why enabling the pragma is an index-destroying "fix".
        expect(db.exec('SELECT COUNT(*) FROM chunks')[0].values[0][0]).toBe(0);
    });
});
