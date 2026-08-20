/**
 * dispose() 的關閉語意。兩個缺陷在 1.5.1 之前都是真的，這裡逐條釘死：
 *
 * 缺陷一：dispose() 先設 `disposed = true` 才呼叫 flush()，而 flush() 第二行是
 *         `if (this.disposed) return;` —— 收尾寫盤是死碼。症狀：最後一次索引
 *         變更後 30 秒（IDLE_FLUSH_MS）內關閉 app，那批更新靜默遺失。
 * 缺陷二：dispose() 從不理會 `flushInFlight`，所以它會在一個已經在飛的寫入還沒
 *         落地時就返回並 close() 資料庫。
 *
 * 這兩條在修法之前都被實測重現過（缺陷一：write 次數 0；缺陷二：事件序為
 * write:start → dispose:returned → write:done），所以下面的斷言不是假綠。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';

const vec = new Float32Array([1, 0]);
const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs(); });

const seedNote = (store: SQLiteStore, path: string, content: string): void => {
    store.upsertNote({
        path, mtime: 1, title: path, description: null, tier: 'hot',
        bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks(path, [{ notePath: path, chunkIndex: 0, content, vec }]);
};

/** Adapter that keeps every write's bytes so we can re-open and inspect them. */
const capturingAdapter = () => {
    const writes: Uint8Array[] = [];
    const adapter: PersistAdapter = {
        read: async () => null,
        write: async (_p, b) => { writes.push(b); },
        exists: async () => false,
    };
    return { adapter, writes };
};

describe('SQLiteStore.dispose() 的收尾寫盤（缺陷一回歸）', () => {
    it('有未寫入變更時，dispose() 會把它們寫出去，而且寫出的位元組真的含那筆資料', async () => {
        const { adapter, writes } = capturingAdapter();
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());

        // 一筆 upsert 讓 mutationCount=1。未達 MUTATION_THRESHOLD(100)，
        // 所以只排 IDLE_FLUSH_MS 的 timer，不會立刻寫盤。
        seedNote(store, 'a.md', '甲筆記講登山裝備');
        expect(writes.length).toBe(0);

        await store.dispose();

        expect(writes.length).toBe(1);
        // 不只斷言「有寫」：把位元組重開，確認那筆真的在裡面
        const db = new SQL.Database(writes[0]);
        const res = db.exec("SELECT path FROM notes WHERE path = 'a.md'");
        db.close();
        expect(res.length).toBe(1);
        expect(res[0].values[0][0]).toBe('a.md');
    });

    it('沒有未寫入變更時，dispose() 不做多餘的寫入', async () => {
        const { adapter, writes } = capturingAdapter();
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
        seedNote(store, 'a.md', '甲筆記講登山裝備');
        await store.flush();
        expect(writes.length).toBe(1);

        await store.dispose();
        expect(writes.length).toBe(1); // 沒有第二次
    });

    it('唯讀 store 的 dispose() 一個字都不寫（015 的唯讀防線不被本次改動繞過）', async () => {
        const { adapter, writes } = capturingAdapter();
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly: true });
        seedNote(store, 'a.md', '甲筆記講登山裝備'); // 唯讀下本身就是 no-op
        await store.dispose();
        expect(writes.length).toBe(0);
    });

    it('dispose() 呼叫兩次：第二次是 no-op，不重複寫、不 throw', async () => {
        const { adapter, writes } = capturingAdapter();
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
        seedNote(store, 'a.md', '甲筆記講登山裝備');

        await store.dispose();
        await expect(store.dispose()).resolves.toBeUndefined();
        expect(writes.length).toBe(1);
    });
});

describe('SQLiteStore.dispose() 與已在飛的寫入（缺陷二回歸）', () => {
    it('dispose() 會等已在飛的 flush 落地才返回', async () => {
        const order: string[] = [];
        let releaseWrite!: () => void;
        const writeGate = new Promise<void>((r) => { releaseWrite = r; });

        const adapter: PersistAdapter = {
            read: async () => null,
            write: async () => {
                order.push('write:start');
                await writeGate;
                order.push('write:done');
            },
            exists: async () => false,
        };
        const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes());
        seedNote(store, 'a.md', '甲筆記講登山裝備');

        void store.flush();                    // 卡在 writeGate 裡
        await Promise.resolve();
        expect(order).toEqual(['write:start']);

        const disposed = store.dispose().then(() => { order.push('dispose:returned'); });
        await Promise.resolve();
        await Promise.resolve();
        // 寫入還沒放行，dispose 不該已經返回
        expect(order).toEqual(['write:start']);

        releaseWrite();
        await disposed;
        expect(order).toEqual(['write:start', 'write:done', 'dispose:returned']);
    });
});
