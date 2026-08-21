/**
 * 015 Task 3: the semantic leg is optional. A null provider means layer-0
 * search (BM25 + fuzzy, the mobile default); a present-but-failing provider
 * degrades to keyword-only with an onDegrade signal instead of poisoning
 * the whole Promise.all (the pre-015 behavior lost both healthy legs).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { searchHybrid } from '../src/search/searchHybrid';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));

const memAdapter: PersistAdapter = {
    read: async () => null,
    write: async () => { /* in-memory */ },
    exists: async () => false,
};

// dim-2 玩具向量空間：queryVec 貼近 [1,0]
const V_MATCH = new Float32Array([1, 0]);      // 語意上「像 query」
const V_FAR = new Float32Array([0, 1]);        // 語意上無關

/** 只回 [1,0] 的健康 provider。 */
const okProvider = (): EmbeddingProvider => ({
    providerType: 'ollama',
    modelId: 'test-model',
    dimension: 2,
    displayName: 'test',
    warmup: async () => {},
    isReady: async () => true,
    embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
    dispose: () => {},
});

/** embed 必炸的 provider（模擬 endpoint 掛掉 / WASM 失敗）。 */
const brokenProvider = (): EmbeddingProvider => ({
    ...okProvider(),
    embed: async () => { throw new Error('endpoint down'); },
});

let store: SQLiteStore;
beforeAll(async () => {
    store = await SQLiteStore.open(memAdapter, 'test.db', wasmBytes());
    // 關鍵字筆記：BM25 能命中「登山裝備」
    store.upsertNote({
        path: 'kw.md', mtime: 1, title: '關鍵字筆記', description: null, tier: 'hot',
        bodyVec: V_FAR, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks('kw.md', [
        { notePath: 'kw.md', chunkIndex: 0, content: '這篇筆記講登山裝備清單', vec: V_FAR },
    ]);
    // 語意筆記：內文與「登山裝備」零字面重疊，但向量 = query 向量
    store.upsertNote({
        path: 'sem.md', mtime: 1, title: '週末計畫', description: null, tier: 'hot',
        bodyVec: V_MATCH, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks('sem.md', [
        { notePath: 'sem.md', chunkIndex: 0, content: '傍晚去河堤散步看夕陽', vec: V_MATCH },
    ]);
    // 019: 幽靈筆記——索引裡有、磁碟上沒有。兩路都命中（字面 + 向量），
    // 所以不過濾時它必然搶到前排，正是「佔住名額」要證的事。
    store.upsertNote({
        path: 'ghost.md', mtime: 1, title: '幽靈筆記', description: null, tier: 'hot',
        bodyVec: V_MATCH, bodyDim: 2, indexedAt: 1, descVec: null,
    });
    store.upsertChunks('ghost.md', [
        { notePath: 'ghost.md', chunkIndex: 0, content: '這篇筆記講登山裝備清單', vec: V_MATCH },
    ]);
});

const SETTINGS = { topResults: 10, searchScope: 'all' as const };

describe('searchHybrid provider-optional（015 Task 3）', () => {
    it('斷言 3（先立基準）：健康 provider 時語意路活著——零字面重疊的筆記進結果', async () => {
        const results = await searchHybrid('登山裝備', { store, provider: okProvider() }, SETTINGS);
        const paths = results.map(r => r.path);
        expect(paths).toContain('kw.md');   // BM25 路
        expect(paths).toContain('sem.md');  // 語意路（唯一能撈到它的路）
    });

    it('斷言 1：provider = null → 層 0 結果（BM25 命中在、語意筆記缺席）、不觸發 onDegrade', async () => {
        const onDegrade = vi.fn();
        const results = await searchHybrid(
            '登山裝備', { store, provider: null }, { ...SETTINGS, onDegrade },
        );
        const paths = results.map(r => r.path);
        expect(paths).toContain('kw.md');
        expect(paths).not.toContain('sem.md');
        expect(onDegrade).not.toHaveBeenCalled(); // 層 0 是模式，不是降級
    });

    it('斷言 2：provider 在但 embed 炸 → 與層 0 同結果 + console.warn + onDegrade("semantic")', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const onDegrade = vi.fn();
        const results = await searchHybrid(
            '登山裝備', { store, provider: brokenProvider() }, { ...SETTINGS, onDegrade },
        );
        const paths = results.map(r => r.path);
        expect(paths).toContain('kw.md');
        expect(paths).not.toContain('sem.md');
        expect(onDegrade).toHaveBeenCalledWith('semantic');
        expect(warn.mock.calls.some(c => String(c[0]).includes('semantic leg failed'))).toBe(true);
        warn.mockRestore();
    });
});

describe('searchHybrid exists 過濾（019 D5）', () => {
    const alive = (path: string) => path !== 'ghost.md';

    it('控制組：不傳 exists 時，幽靈確實搶進 top-2（證明下一條斷言有在咬）', async () => {
        const results = await searchHybrid(
            '登山裝備', { store, provider: okProvider() }, { ...SETTINGS, topResults: 2 },
        );
        expect(results.map(r => r.path)).toContain('ghost.md');
    });

    it('斷言 1：幽靈不佔 top-N 名額——topResults=2 仍回兩筆真結果', async () => {
        const results = await searchHybrid(
            '登山裝備', { store, provider: okProvider() }, { ...SETTINGS, topResults: 2, exists: alive },
        );
        expect(results.map(r => r.path).sort()).toEqual(['kw.md', 'sem.md']);
    });

    it('斷言 2：不傳 exists 時行為與過濾前一致（幽靈仍在結果內）', async () => {
        const results = await searchHybrid('登山裝備', { store, provider: okProvider() }, SETTINGS);
        expect(results.map(r => r.path)).toContain('ghost.md');
    });

    it('斷言 3：exists 早於 scope/tier 判定——tierResolver 從未被問到幽靈', async () => {
        const tierResolver = vi.fn((_path: string) => 'hot' as const);
        const results = await searchHybrid(
            '登山裝備',
            { store, provider: okProvider() },
            { ...SETTINGS, searchScope: 'hot', exists: alive, tierResolver },
        );
        expect(results.map(r => r.path)).not.toContain('ghost.md');
        expect(tierResolver).toHaveBeenCalledWith('kw.md');
        expect(tierResolver).not.toHaveBeenCalledWith('ghost.md');
    });
});
