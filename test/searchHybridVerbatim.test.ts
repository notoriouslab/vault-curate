/**
 * 038: a query that is literally a note's heading or a "quoted" phrase from
 * it puts that note first, even when another note wins on keyword volume
 * and meaning. Written red-first against 1.11.0 behaviour.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { searchHybrid } from '../src/search/searchHybrid';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
const memAdapter: PersistAdapter = { read: async () => null, write: async () => {}, exists: async () => false };
const NEAR = new Float32Array([1, 0]);
const FAR = new Float32Array([0, 1]);
const provider: EmbeddingProvider = {
    providerType: 'ollama', modelId: 'test', dimension: 2, displayName: 'test',
    warmup: async () => {}, isReady: async () => true, dispose: () => {},
    embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
};
const SETTINGS = { topResults: 10, searchScope: 'all' as const };

let store: SQLiteStore;
beforeAll(async () => {
    store = await SQLiteStore.open(memAdapter, 'verbatim.db', wasmBytes());
    const note = (path: string, title: string, content: string, vec: Float32Array) => {
        store.upsertNote({ path, mtime: 1, title, description: null, tier: 'hot', bodyVec: vec, bodyDim: 2, indexedAt: 1, descVec: null });
        store.upsertChunks(path, [{ notePath: path, chunkIndex: 0, content: `${title}\n${content}`, vec }]);
    };
    note('heading.md', '專案筆記', '## 建議優先順序\n先做清單，再排時程。', FAR);
    note('volume.md', '想法', '建議優先順序很重要。建議優先順序要常檢查。建議優先順序會變。', NEAR);
    note('quote.md', '週記', '我們約在台北車站前集合。', FAR);
    note('crowd.md', '交通', '台北車站很大。台北車站人多。車站前有公車。台北車站前面也有計程車。', NEAR);
    // Several chunks: chunk 0 wins BM25 on volume; chunks 1 and 2 both carry the
    // heading, and chunk 2 outranks chunk 1 in BM25, so only the index order picks 1.
    store.upsertNote({ path: 'multi.md', mtime: 1, title: '計畫書', description: null, tier: 'hot', bodyVec: FAR, bodyDim: 2, indexedAt: 1, descVec: null });
    store.upsertChunks('multi.md', [
        { notePath: 'multi.md', chunkIndex: 0, content: '計畫書\n行程安排先確認。行程安排再調整。行程安排要記錄。', vec: FAR },
        { notePath: 'multi.md', chunkIndex: 1, content: '計畫書\n## 行程安排\n第一天出發。', vec: FAR },
        { notePath: 'multi.md', chunkIndex: 2, content: '計畫書\n## 行程安排\n行程安排第二天回程，行程安排結束。', vec: FAR },
    ]);
    // The phrase sits only in the title (not at its start); the body lacks it.
    note('titled.md', '去北投泡湯的週末', '整天都在山上走路。', FAR);
});

const first = async (q: string, p: EmbeddingProvider | null) =>
    (await searchHybrid(q, { store, provider: p }, SETTINGS))[0]?.path;

describe('verbatim-match boost (038 D2-D4)', () => {
    it('a heading typed as-is ranks its note first', async () => {
        expect(await first('建議優先順序', provider)).toBe('heading.md');
    });

    it('a quoted phrase ranks the note that contains it first', async () => {
        expect(await first('"約在台北車站前"', provider)).toBe('quote.md');
    });

    it('shows and highlights the heading in the snippet', async () => {
        const r = (await searchHybrid('建議優先順序', { store, provider }, SETTINGS))[0];
        const hl = r.snippet!.ranges.map(([a, b]) => r.snippet!.text.slice(a, b));
        expect(hl).toContain('建議優先順序');
    });

    it('shows the earliest chunk that carries the heading, not the BM25 winner', async () => {
        const r = (await searchHybrid('行程安排', { store, provider }, SETTINGS)).find(x => x.path === 'multi.md')!;
        expect(r.snippet!.chunkIndex).toBe(1);
    });

    it('matches the query as typed, not its synonym expansion', async () => {
        const res = await searchHybrid('建議優先順序', { store, provider }, { ...SETTINGS, synonyms: { 建議優先順序: ['注意事項'] } });
        expect(res[0].path).toBe('heading.md');
        const expanded = await searchHybrid('注意事項', { store, provider }, { ...SETTINGS, synonyms: { 注意事項: ['建議優先順序'] } });
        expect(expanded[0]?.path === 'heading.md' && expanded[0].score > 1 / 61).not.toBe(true);
    });

    it('does not count a quoted phrase that only appears in the title', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        await searchHybrid('"北投泡湯"', { store, provider: null }, SETTINGS);
        const boosted = debug.mock.calls.some(c => String(c[0]).includes('verbatim boost'));
        debug.mockRestore();
        expect(boosted).toBe(false);
    });

    it('works without the semantic leg (mobile)', async () => {
        expect(await first('建議優先順序', null)).toBe('heading.md');
    });
});
