/**
 * 015 Task 2: read-only store mode — the mobile side of "desktop builds,
 * mobile reads". The disk has exactly one write exit (flush → adapter.write);
 * these tests pin that exit shut under readOnly and prove the in-memory DB
 * still works (schema DDL / migration / prune all stay RAM-only).
 *
 * 斷言 6 的實作註記（G1 C1）：migration 流程不需要額外 readOnly 檢查——
 * 防線在 flush 出口，不在 migration 內。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';

const vec = new Float32Array([1, 0]);
const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));

let SQL: SqlJsStatic;
beforeAll(async () => {
    SQL = await initSqlJs();
});

/** Adapter that counts writes — the whole point of the suite. */
const countingAdapter = (bytes: Uint8Array | null) => {
    const counter = { writes: 0 };
    const adapter: PersistAdapter = {
        read: async () => bytes,
        write: async () => { counter.writes++; },
        exists: async () => bytes !== null,
    };
    return { adapter, counter };
};

const seedNote = (store: SQLiteStore, path: string, content: string): void => {
    store.upsertNote({
        path, mtime: 1, title: path, description: null, tier: 'hot',
        bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks(path, [{ notePath: path, chunkIndex: 0, content, vec }]);
};

/** Build valid v3 index bytes via a writable store (write captured, not persisted). */
const buildIndexBytes = async (mutate?: (db: InstanceType<SqlJsStatic['Database']>) => void): Promise<Uint8Array> => {
    let captured: Uint8Array | null = null;
    const adapter: PersistAdapter = {
        read: async () => null,
        write: async (_p, b) => { captured = b; },
        exists: async () => false,
    };
    const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
    seedNote(store, 'a.md', '甲筆記講登山裝備');
    seedNote(store, 'b.md', '乙筆記講咖啡烘焙');
    await store.flush();
    await store.dispose();
    if (!captured) throw new Error('fixture flush produced no bytes');
    if (!mutate) return captured;
    const db = new SQL.Database(captured);
    mutate(db);
    const out = db.export();
    db.close();
    return out;
};

describe('SQLiteStore readOnly（015 Task 2）', () => {
    it('斷言 1：setMeta 是 no-op，getMeta 維持原值，console.warn 恰一次', async () => {
        const bytes = await buildIndexBytes((db) => {
            db.run("INSERT OR REPLACE INTO meta(key, value) VALUES('probe', 'original')");
        });
        const { adapter } = countingAdapter(bytes);
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        store.setMeta('probe', 'overwritten');
        store.setMeta('probe', 'overwritten-again');
        expect(store.getMeta('probe')).toBe('original');
        expect(warn.mock.calls.filter(c => String(c[0]).includes('read-only store'))).toHaveLength(1);
        warn.mockRestore();
    });

    it('斷言 2：flush() 不落盤（write 呼叫 = 0）', async () => {
        const bytes = await buildIndexBytes();
        const { adapter, counter } = countingAdapter(bytes);
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly: true });
        await store.flush();
        expect(counter.writes).toBe(0);
    });

    it('斷言 3：含孤兒 chunk 的 fixture — prune 後不落盤，且 BM25 不含孤兒', async () => {
        const bytes = await buildIndexBytes((db) => {
            db.run(
                "INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES('ghost.md', 0, '幽靈孤兒段落', ?)",
                [new Uint8Array(vec.buffer.slice(0))],
            );
        });
        const { adapter, counter } = countingAdapter(bytes);
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly: true });
        // idle flush 是 30 秒後排程；readOnly 下 prune 根本不 touch，不會有排程。
        // 直接主動 flush 一次證明出口關死。
        await store.flush();
        expect(counter.writes).toBe(0);
        expect(store.searchBM25('幽靈孤兒', 10)).toHaveLength(0);
        expect(store.searchBM25('登山裝備', 10).length).toBeGreaterThan(0);
    });

    it('斷言 4：dispose() 不落盤', async () => {
        const bytes = await buildIndexBytes();
        const { adapter, counter } = countingAdapter(bytes);
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        store.setMeta('dirty-attempt', 'x'); // 即使有人嘗試弄髒
        warn.mockRestore();
        await store.dispose();
        expect(counter.writes).toBe(0);
    });

    it('斷言 5：對照組——非 readOnly 同 fixture，write ≥ 1（防測試自身失真）', async () => {
        const bytes = await buildIndexBytes((db) => {
            db.run(
                "INSERT INTO chunks(note_path, chunk_index, content, vec) VALUES('ghost.md', 0, '幽靈孤兒段落', ?)",
                [new Uint8Array(vec.buffer.slice(0))],
            );
        });
        const { adapter, counter } = countingAdapter(bytes);
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
        store.setMeta('probe', 'v');
        await store.flush();
        expect(counter.writes).toBeGreaterThanOrEqual(1);
        await store.dispose();
    });

    it('斷言 6：v2 schema 在 readOnly 下 in-memory migration 照跑、查詢可用、不落盤', async () => {
        // 手工建 v2 形狀：notes 無 desc_vec 欄、meta schema_version=2
        const db = new SQL.Database();
        db.run(`CREATE TABLE notes (
            path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, title TEXT,
            description TEXT, tier TEXT, body_vec BLOB, body_dim INTEGER NOT NULL,
            indexed_at INTEGER NOT NULL)`);
        db.run(`CREATE TABLE chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL, content TEXT NOT NULL, vec BLOB NOT NULL,
            UNIQUE(note_path, chunk_index))`);
        db.run(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
        db.run(`CREATE TABLE synonyms (term TEXT NOT NULL, expansion TEXT NOT NULL)`);
        db.run("INSERT INTO meta(key, value) VALUES('schema_version', '2')");
        db.run("INSERT INTO meta(key, value) VALUES('last_indexed_at', '2026-08-01T00:00:00Z')");
        db.run(
            `INSERT INTO notes(path, mtime, title, description, tier, body_vec, body_dim, indexed_at)
             VALUES('v2.md', 1, 'v2 舊筆記', NULL, 'hot', ?, 2, 1)`,
            [new Uint8Array(vec.buffer.slice(0))],
        );
        const bytes = db.export();
        db.close();

        const { adapter, counter } = countingAdapter(bytes);
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly: true });
        // migration 完成的證據：desc_vec 欄已存在（getNote 讀 desc_vec 不炸）且版本讀得到
        expect(store.getNote('v2.md')?.title).toBe('v2 舊筆記');
        expect(store.getMeta('schema_version')).toBe('3');
        await store.flush();
        await store.dispose();
        expect(counter.writes).toBe(0);
    });
});
