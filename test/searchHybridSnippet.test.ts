import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { searchHybrid } from '../src/search/searchHybrid';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
const memAdapter: PersistAdapter = { read: async () => null, write: async () => {}, exists: async () => false };
const V_MATCH = new Float32Array([1, 0]);
const V_NEAR = new Float32Array([0.8, 0.6]);
const V_FAR = new Float32Array([0, 1]);
const provider: EmbeddingProvider = {
    providerType: 'ollama', modelId: 'test-model', dimension: 2, displayName: 'test',
    warmup: async () => {}, isReady: async () => true,
    embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
    dispose: () => {},
};

let store: SQLiteStore;
beforeAll(async () => {
    store = await SQLiteStore.open(memAdapter, 'test.db', wasmBytes());
    const note = (path: string, title: string, description: string | null, vec: Float32Array) =>
        store.upsertNote({ path, mtime: 1, title, description, tier: 'hot', bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null });
    note('deep.md', '長篇紀錄', null, V_FAR);
    store.upsertChunks('deep.md', [
        { notePath: 'deep.md', chunkIndex: 0, content: '長篇紀錄\n開頭寫的是天氣與行程安排', vec: V_FAR },
        { notePath: 'deep.md', chunkIndex: 1, content: '長篇紀錄\n後段才提到登山裝備要帶頭燈與雨衣', vec: V_NEAR },
    ]);
    note('desc.md', '裝備整理', '這篇整理登山裝備的採購清單', V_FAR);
    store.upsertChunks('desc.md', [
        { notePath: 'desc.md', chunkIndex: 0, content: '裝備整理\n內文只列了品牌與價格', vec: V_FAR },
    ]);
    note('sem.md', '週末計畫', null, V_MATCH);
    store.upsertChunks('sem.md', [
        { notePath: 'sem.md', chunkIndex: 0, content: '週末計畫\n傍晚去河堤散步看夕陽', vec: V_MATCH },
    ]);
    note('title.md', '登山裝備清單', null, V_FAR);
    store.upsertChunks('title.md', [
        { notePath: 'title.md', chunkIndex: 0, content: '登山裝備清單\n空白', vec: V_FAR },
    ]);
});

const SETTINGS = { topResults: 10, searchScope: 'all' as const };
const QUERIES = ['登山裝備', '夕陽', '頭燈 雨衣'];

// Recorded by running this fixture against the pre-034 searchHybrid (before
// the leg maps carried winning chunks). Snippets must not move any result.
const BASELINE: Record<string, Array<[string, number]>> = {"登山裝備": [["title.md", 0.040215163934426236], ["desc.md", 0.03200204813108039], ["deep.md", 0.03200204813108039], ["sem.md", 0.01639344262295082]], "夕陽": [["sem.md", 0.03278688524590164], ["deep.md", 0.016129032258064516], ["desc.md", 0.015873015873015872], ["title.md", 0.015625]], "頭燈 雨衣": [["deep.md", 0.03252247488101534], ["sem.md", 0.01639344262295082], ["desc.md", 0.015873015873015872], ["title.md", 0.015625]]};

describe('searchHybrid with snippets (034 D3)', () => {
    it('keeps the pre-034 ranking and scores exactly', async () => {
        for (const q of QUERIES) {
            const r = await searchHybrid(q, { store, provider }, SETTINGS);
            expect(r.map((x) => [x.path, x.score])).toEqual(BASELINE[q]);
        }
    });

    it('shows the deep chunk that matched, not the note head', async () => {
        const r = await searchHybrid('頭燈 雨衣', { store, provider }, SETTINGS);
        const deep = r.find((x) => x.path === 'deep.md')!;
        expect(deep.snippet?.source).toBe('bm25');
        expect(deep.snippet?.chunkIndex).toBe(1);
        expect(deep.snippet?.chunkCount).toBe(2);
        expect(deep.snippet?.text).toContain('頭燈');
        expect(deep.snippet?.anchor?.startsWith('頭燈')).toBe(true);
    });

    it('falls back to the description when only it matched the keywords', async () => {
        const r = await searchHybrid('登山裝備', { store, provider }, SETTINGS);
        const desc = r.find((x) => x.path === 'desc.md')!;
        expect(desc.snippet?.source).toBe('description');
        expect(desc.snippet?.anchor).toBeNull();
    });
});
