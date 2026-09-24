import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { searchHybrid, SEMANTIC_CHUNK_PENALTY } from '../src/search/searchHybrid';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
const memAdapter: PersistAdapter = { read: async () => null, write: async () => {}, exists: async () => false };
const unit = (c: number) => new Float32Array([c, Math.sqrt(1 - c * c)]);
const provider: EmbeddingProvider = {
    providerType: 'ollama', modelId: 'm', dimension: 2, displayName: 't',
    warmup: async () => {}, isReady: async () => true, dispose: () => {},
    embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
};

let store: SQLiteStore;
beforeAll(async () => {
    store = await SQLiteStore.open(memAdapter, 'agg.db', wasmBytes());
    // A long note: eight chunks, each 0.80 similar. A short note: one chunk, 0.79.
    store.upsertNote({ path: 'long.md', mtime: 1, title: 'alpha', description: null, tier: 'hot', bodyVec: unit(0.8), bodyDim: 2, indexedAt: 1, descVec: null });
    store.upsertChunks('long.md', Array.from({ length: 8 }, (_, i) => ({ notePath: 'long.md', chunkIndex: i, content: `alpha\nsegment ${i}`, vec: unit(0.8) })));
    store.upsertNote({ path: 'short.md', mtime: 1, title: 'beta', description: null, tier: 'hot', bodyVec: unit(0.79), bodyDim: 2, indexedAt: 1, descVec: null });
    store.upsertChunks('short.md', [{ notePath: 'short.md', chunkIndex: 0, content: 'beta\nsingle', vec: unit(0.79) }]);
});

describe('semantic leg aggregation (034 T8 ruling)', () => {
    it('uses a 0.02 ln(chunks) penalty', () => {
        expect(SEMANTIC_CHUNK_PENALTY).toBe(0.02);
    });

    it('does not let a many-chunk note win on chunk count alone', async () => {
        // 0.80 - 0.02 ln 8 = 0.758 < 0.79: the single-chunk note ranks first.
        const r = await searchHybrid('zzz', { store, provider }, { topResults: 10, searchScope: 'all' });
        expect(r.map((x) => x.path)).toEqual(['short.md', 'long.md']);
    });
});
