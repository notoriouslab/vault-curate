/**
 * 019 Task 1: the ghost-row reconcile primitives (issue #13).
 *
 * findStalePaths is the whole judgment, kept pure so the "which rows are
 * dead" question is testable without an Obsidian vault. listNotePaths is its
 * supply: the reconcile pass MUST see rows that getAllBodyVecs() hides
 * (body_vec NULL), or a legacy ghost survives even a manual Update index.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { findStalePaths } from '../src/indexer/staleReconcile';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';

const vec = new Float32Array([1, 0]);
const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));

let SQL: SqlJsStatic;
beforeAll(async () => {
    SQL = await initSqlJs();
});

const seedNote = (store: SQLiteStore, path: string): void => {
    store.upsertNote({
        path, mtime: 1, title: path, description: null, tier: 'hot',
        bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks(path, [{ notePath: path, chunkIndex: 0, content: `內容 ${path}`, vec }]);
};

/** Build v3 index bytes, optionally patched with raw SQL (mirrors the
 *  readonly suite's fixture helper). */
const buildIndexBytes = async (mutate?: (db: InstanceType<SqlJsStatic['Database']>) => void): Promise<Uint8Array> => {
    let captured: Uint8Array | null = null;
    const adapter: PersistAdapter = {
        read: async () => null,
        write: async (_p, b) => { captured = b; },
        exists: async () => false,
    };
    const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
    seedNote(store, 'a.md');
    seedNote(store, 'b.md');
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

const openFrom = async (bytes: Uint8Array): Promise<SQLiteStore> => {
    const adapter: PersistAdapter = {
        read: async () => bytes,
        write: async () => { /* in-memory */ },
        exists: async () => true,
    };
    return SQLiteStore.open(adapter, 'test.db', wasmBytes());
};

describe('findStalePaths（019 D1）', () => {
    const all = () => true;
    const none = () => false;

    it('斷言 1a：全部存在 → 空清單', () => {
        expect(findStalePaths(['a.md', 'b/c.md'], all)).toEqual([]);
    });

    it('斷言 1b：全部不存在 → 全列，且順序等於輸入順序', () => {
        const input = ['z.md', 'a.md', 'm/n.md'];
        expect(findStalePaths(input, none)).toEqual(input);
    });

    it('斷言 1c：混合 → 只回不存在的', () => {
        const live = new Set(['keep.md', 'dir/keep.md']);
        const out = findStalePaths(
            ['keep.md', 'gone.md', 'dir/keep.md', 'dir/gone.md'],
            (p) => live.has(p),
        );
        expect(out).toEqual(['gone.md', 'dir/gone.md']);
    });

    it('斷言 1d：空輸入 → 空清單（不呼叫 predicate）', () => {
        let calls = 0;
        expect(findStalePaths([], () => { calls++; return true; })).toEqual([]);
        expect(calls).toBe(0);
    });

    it('斷言 1e：吃任何 Iterable（Map.keys() 就是實際呼叫形）', () => {
        const m = new Map([['live.md', 1], ['dead.md', 2]]);
        expect(findStalePaths(m.keys(), (p) => p === 'live.md')).toEqual(['dead.md']);
    });

    it('斷言 2：不做大小寫正規化 — 判定權完全在注入的 predicate', () => {
        const live = new Set(['A/b.md']);
        // 大小寫不敏感的檔案系統上這是同一個檔，但 Obsidian 的檔案表是
        // 大小寫敏感的 map；函數不自作聰明，照 predicate 的答案回報。
        expect(findStalePaths(['A/b.md'], (p) => live.has(p))).toEqual([]);
        expect(findStalePaths(['a/B.md'], (p) => live.has(p))).toEqual(['a/B.md']);
    });
});

describe('SQLiteStore.listNotePaths（019 D2）', () => {
    it('斷言 3：body_vec 為 NULL 的 legacy row 仍會被列出（getAllBodyVecs 看不到）', async () => {
        const bytes = await buildIndexBytes((db) => {
            db.run("UPDATE notes SET body_vec = NULL WHERE path = 'b.md'");
        });
        const store = await openFrom(bytes);
        try {
            expect(store.listNotePaths().sort()).toEqual(['a.md', 'b.md']);
            expect([...store.getAllBodyVecs().keys()]).toEqual(['a.md']);
        } finally {
            await store.dispose();
        }
    });

    it('斷言 3b：空索引 → 空陣列', async () => {
        const adapter: PersistAdapter = {
            read: async () => null,
            write: async () => { /* in-memory */ },
            exists: async () => false,
        };
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
        try {
            expect(store.listNotePaths()).toEqual([]);
        } finally {
            await store.dispose();
        }
    });
});
