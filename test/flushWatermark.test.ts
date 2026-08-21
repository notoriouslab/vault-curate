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

/** Adapter that records concurrency + can fail on demand（審查補洞用）。 */
const instrumentedAdapter = (opts: { delayMs?: number; failNth?: number } = {}) => {
    const delayMs = opts.delayMs ?? 40;
    const state = { writes: 0, concurrent: 0, maxConcurrent: 0, last: null as Uint8Array | null };
    const adapter: PersistAdapter = {
        read: async () => null,
        write: async (_p, bytes) => {
            state.writes++;
            state.concurrent++;
            state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
            try {
                await new Promise((r) => setTimeout(r, delayMs));
                if (opts.failNth === state.writes) throw new Error('EIO');
                state.last = bytes;
            } finally {
                state.concurrent--;
            }
        },
        exists: async () => false,
    };
    return { adapter, state };
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

describe('flush()／dispose() 交錯與初始狀態（020 審查補洞）', () => {
    it('斷言 7：從既有檔載入、零變更 → dispose() 一個字節都不寫（紅隊 C1）', async () => {
        // 先做一份有內容的索引 bytes
        const first = slowAdapter();
        const seedStore = await SQLiteStore.open(first.adapter, 'wm.db', wasmBytes());
        seed(seedStore, 0);
        await seedStore.flush();
        const bytes = first.state.last!;
        expect(persistedCount(bytes)).toBe(1);

        // 重新開它，什麼都不做就關掉
        const state = { writes: 0 };
        const adapter: PersistAdapter = {
            read: async () => bytes,
            write: async () => { state.writes++; },
            exists: async () => true,
        };
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        expect(store.listNotePaths()).toHaveLength(1);
        await store.dispose();
        expect(state.writes).toBe(0);
    });

    it('斷言 8：dispose() 搶先時 flush() 不得假 resolve——回來時狀態必須真的在磁碟上（審查 C1）', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 150; i++) seed(store, i);   // 跨門檻，製造陳舊的背景寫盤
        const flushing = store.flush();                 // 卡在等那次陳舊寫盤
        const disposing = store.dispose();              // 同 tick 搶進來
        await flushing;
        // flush 回來的那一刻，磁碟必須已經有全部 150 筆（不是陳舊的 100 筆）
        expect(persistedCount(state.last)).toBe(150);
        await disposing;
    });

    it('斷言 8b：dispose() 已啟動之後才呼叫的 flush()，同樣不得假 resolve（入口守衛）', async () => {
        const { adapter, state } = slowAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 300; i++) seed(store, i);
        const disposing = store.dispose();   // 先啟動，不等它
        await store.flush();                 // 後到的呼叫者
        expect(persistedCount(state.last)).toBe(300);
        await disposing;
    });

    it('斷言 9：迴圈的 disposed 守衛擋住併發寫盤——同一路徑不得有兩個寫入同時在飛（紅隊 W2）', async () => {
        const { adapter, state } = instrumentedAdapter();
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 150; i++) seed(store, i);
        const flushing = store.flush();
        const disposing = store.dispose();
        await Promise.all([flushing, disposing]);
        expect(state.maxConcurrent).toBe(1);
    });

    it('斷言 10：飛行中的寫盤失敗，收尾寫盤仍然落地（紅隊 W1）', async () => {
        const { adapter, state } = instrumentedAdapter({ failNth: 1 });
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 150; i++) seed(store, i);   // 第 1 次寫盤會炸
        await store.dispose();                          // 不得被那個 rejection 帶走
        expect(state.writes).toBeGreaterThanOrEqual(2);
        expect(persistedCount(state.last)).toBe(150);
    });

    it('斷言 11：flush() 期間持續灌入變更，寫盤次數仍有界（target 凍結，審查 W2）', async () => {
        const { adapter, state } = slowAdapter(20);
        const store = await SQLiteStore.open(adapter, 'wm.db', wasmBytes());
        for (let i = 0; i < 150; i++) seed(store, i);
        const flushing = store.flush();
        // flush 執行期間每個 tick 都插入新變更
        for (let round = 0; round < 20; round++) {
            await new Promise((r) => setTimeout(r, 5));
            seed(store, 1000 + round);
        }
        await flushing;
        // 沒有凍結 target 的話，這裡會隨插入次數線性成長
        expect(state.writes).toBeLessThanOrEqual(4);
        await store.dispose();
    });
});
