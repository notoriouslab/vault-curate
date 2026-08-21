/**
 * 020: `await flush()` means "my state is on disk" — and the write count
 * stays bounded while it does.
 *
 * The bug this pins: flush() used to hand back whatever write was already in
 * flight. Those bytes were exported when THAT write started, so every
 * mutation behind it stayed in memory while flush() resolved successfully.
 * Measured before the fix — 300 rows in memory, 100 on disk — and observed on
 * a real 2522-note vault, where a manual "Update index" that pruned 2600 rows
 * left the on-disk index at the 100-row mark. dispose() then skipped its
 * farewell write too, because the stale write had reset mutationCount to 0.
 *
 * Both halves are asserted here: correctness (the tail reaches disk) and the
 * cost of that correctness (writes per burst, so the fix can never turn a
 * 73MB index into a write storm).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
const vec = new Float32Array([1, 0]);

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs(); });

/** Rows in the last bytes the adapter received. */
const persistedCount = (bytes: Uint8Array | null): number => {
    if (!bytes) return -1;
    const db = new SQL.Database(bytes);
    const n = db.exec('SELECT COUNT(*) FROM notes')[0].values[0][0] as number;
    db.close();
    return n;
};

/** Adapter with a deliberately slow write — the whole bug lives in the window
 *  where one export is in flight and mutations pile up behind it. */
const slowAdapter = (delayMs = 40) => {
    const state = { writes: 0, last: null as Uint8Array | null };
    const adapter: PersistAdapter = {
        read: async () => null,
        write: async (_p, bytes) => {
            state.writes++;
            await new Promise((r) => setTimeout(r, delayMs));
            state.last = bytes;
        },
        exists: async () => false,
    };
    return { adapter, state };
};

const seed = (store: SQLiteStore, i: number): void => {
    store.upsertNote({
        path: `n${i}.md`, mtime: 1, title: `t${i}`, description: null,
        tier: 'hot', bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null,
    });
};

describe('flush() 落盤語意（020）', () => {
    it('斷言 1：300 筆同步寫入後 await flush() → 磁碟上就是 300 筆（修前是 100）', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 300; i++) seed(store, i);
        expect(store.listNotePaths()).toHaveLength(300);
        await store.flush();
        expect(persistedCount(state.last)).toBe(300);
        await store.dispose();
    });

    it('斷言 2：寫盤次數有上限——300 筆爆量最多 3 次寫盤（防 73MB 寫盤風暴）', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 300; i++) seed(store, i);
        await store.flush();
        expect(state.writes).toBeLessThanOrEqual(3);
        await store.dispose();
    });

    it('斷言 3：狀態沒變時 flush() 不再寫盤（不做白工）', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        seed(store, 0);
        await store.flush();
        const after = state.writes;
        await store.flush();
        await store.flush();
        expect(state.writes).toBe(after);
        await store.dispose();
    });

    it('斷言 4：寫盤途中新增的變更，下一次 flush() 會補上', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 150; i++) seed(store, i);      // 跨過門檻，觸發背景寫盤
        const pending = store.flush();
        seed(store, 9001);                                  // 寫盤飛行中插入
        await pending;
        await store.flush();
        expect(persistedCount(state.last)).toBe(151);
        await store.dispose();
    });

    it('斷言 5：dispose() 的收尾寫盤看 watermark，不看 mutationCount', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 300; i++) seed(store, i);
        // 不呼叫 flush()：讓門檻觸發的那次寫盤把 mutationCount 歸零，
        // 這正是實機上讓 2500 筆消失的狀態。
        await store.dispose();
        expect(persistedCount(state.last)).toBe(300);
    });

    it('斷言 6：readOnly 仍然一個字節都不寫（015 的承諾不被 020 破壞）', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes(), { readOnly: true });
        for (let i = 0; i < 300; i++) seed(store, i);
        await store.flush();
        await store.dispose();
        expect(state.writes).toBe(0);
    });
});
