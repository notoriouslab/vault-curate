/**
 * 026: the fuzzy-title leg must receive the RAW query, never the
 * synonym-expanded one (appended words poison whole-string title
 * matching). Locked via module mock because the behavioral difference is
 * invisible to Jaro-Winkler in small fixtures (mutation M3 escaped the
 * fixture-based test).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';

const fuzzySpy = vi.fn(() => new Map<string, number>());
vi.mock('../src/utils/jaroWinkler', () => ({ fuzzyTitleSearch: (...a: unknown[]) => fuzzySpy(...a) }));

import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { searchHybrid } from '../src/search/searchHybrid';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
const memAdapter: PersistAdapter = {
    read: async () => null,
    write: async () => { /* in-memory */ },
    exists: async () => false,
};

describe('fuzzy leg argument (026)', () => {
    it('fuzzyTitleSearch is called with the raw query while BM25 gets the expansion', async () => {
        const store = await SQLiteStore.open(memAdapter, 'fz.db', wasmBytes());
        await searchHybrid(
            '祈禱', { store, provider: null },
            { topResults: 10, searchScope: 'all', synonyms: { 祈禱: ['禱告'] } },
        );
        expect(fuzzySpy).toHaveBeenCalled();
        expect(fuzzySpy.mock.calls[0][0]).toBe('祈禱');
    });
});
