/**
 * 038: a query that is literally a note's heading or a "quoted" phrase from
 * it puts that note first, even when another note wins on keyword volume
 * and meaning. Written red-first against 1.11.0 behaviour.
 */
import { describe, it, expect, beforeAll } from 'vitest';
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

    it('works without the semantic leg (mobile)', async () => {
        expect(await first('建議優先順序', null)).toBe('heading.md');
    });
});
