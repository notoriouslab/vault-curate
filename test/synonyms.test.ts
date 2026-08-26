/**
 * 026: synonym expansion — wired in v0.1.0, silently lost in the Phase 5
 * hybrid-fusion rewrite (78f808f), re-wired 2026-08-25. The unit half
 * pins expandQuery; the integration half proves the BM25 leg actually
 * sees the expansion (the regression that went unnoticed for a year was
 * exactly "function exists, nothing calls it") and that the fuzzy-title
 * leg keeps the raw query.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { expandQuery } from '../src/synonyms';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { searchHybrid } from '../src/search/searchHybrid';

describe('expandQuery', () => {
    const DICT = { 小陳: ['陳大文'], 祈禱: ['禱告', '代禱'] };

    it('appends synonyms when a key appears in the query', () => {
        expect(expandQuery('小陳 的筆記', DICT)).toBe('小陳 的筆記 陳大文');
        expect(expandQuery('祈禱', DICT)).toBe('祈禱 禱告 代禱');
    });

    it('passes through with no dict, empty dict, or no key match', () => {
        expect(expandQuery('登山', undefined)).toBe('登山');
        expect(expandQuery('登山', {})).toBe('登山');
        expect(expandQuery('登山', DICT)).toBe('登山');
    });

    it('never duplicates a term already in the query, and dedupes additions', () => {
        expect(expandQuery('小陳 陳大文', DICT)).toBe('小陳 陳大文');
        expect(expandQuery('a', { a: ['x'], ab: ['x'] })).toBe('a x');
    });
});

describe('searchHybrid synonym expansion (026)', () => {
    const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
    const memAdapter: PersistAdapter = {
        read: async () => null,
        write: async () => { /* in-memory */ },
        exists: async () => false,
    };
    const VEC = new Float32Array([1, 0]);

    let store: SQLiteStore;
    beforeAll(async () => {
        store = await SQLiteStore.open(memAdapter, 'syn.db', wasmBytes());
        // The note says 禱告 only — a 祈禱 query reaches it solely via
        // expansion. NOTE the punctuation before 禱告: BM25 tokenizes CJK
        // runs longer than 3 chars into trigrams only, so a 2-char query
        // term matches solely where it occurs as an isolated short run
        // (real example: the title "先知性 禱告"). A 2-char synonym
        // embedded mid-sentence is invisible to BM25 — that hop belongs
        // to the semantic leg. This fixture mirrors the isolated case.
        store.upsertNote({
            path: 'target.md', mtime: 1, title: '小組聚會', description: null, tier: 'hot',
            bodyVec: VEC, bodyDim: 2, indexedAt: 1, descVec: null,
        });
        store.upsertChunks('target.md', [
            { notePath: 'target.md', chunkIndex: 0, content: '本週小組聚會重點：禱告', vec: VEC },
        ]);
    });

    const SETTINGS = { topResults: 10, searchScope: 'all' as const };

    it('control: without a dict the alias query misses the note (keyword-only mode)', async () => {
        const results = await searchHybrid('祈禱', { store, provider: null }, SETTINGS);
        expect(results.map(r => r.path)).not.toContain('target.md');
    });

    it('with the dict the BM25 leg bridges alias → canonical', async () => {
        const results = await searchHybrid(
            '祈禱', { store, provider: null },
            { ...SETTINGS, synonyms: { 祈禱: ['禱告'] } },
        );
        expect(results.map(r => r.path)).toContain('target.md');
    });

    it('the semantic leg sees the expanded query too (rank flips with the dict)', async () => {
        // Fresh store, rank-based: the semantic leg has no score floor, so
        // in a tiny corpus everything reaches top-10 — membership can't
        // discriminate. Provider embeds the synonym to [1,0] and anything
        // else to [0,1] (runSemantic converts t2s first, 禱 → 祷), so
        // sem-target ([1,0]) ranks FIRST only when the semantic leg saw
        // the expanded query (kills mutation M2).
        const s2 = await SQLiteStore.open(memAdapter, 'syn2.db', wasmBytes());
        s2.upsertNote({
            path: 'other.md', mtime: 1, title: 'other', description: null, tier: 'hot',
            bodyVec: new Float32Array([0, 1]), bodyDim: 2, indexedAt: 1, descVec: null,
        });
        s2.upsertChunks('other.md', [
            { notePath: 'other.md', chunkIndex: 0, content: 'aaa', vec: new Float32Array([0, 1]) },
        ]);
        s2.upsertNote({
            path: 'sem-target.md', mtime: 1, title: '無關標題', description: null, tier: 'hot',
            bodyVec: VEC, bodyDim: 2, indexedAt: 1, descVec: null,
        });
        s2.upsertChunks('sem-target.md', [
            { notePath: 'sem-target.md', chunkIndex: 0, content: 'zzz', vec: VEC },
        ]);
        const provider = {
            providerType: 'ollama' as const, modelId: 'm', dimension: 2, displayName: 't',
            warmup: async () => {}, isReady: async () => true, dispose: () => {},
            embed: async (texts: string[]) => texts.map((x) =>
                (x.includes('禱告') || x.includes('祷告'))
                    ? new Float32Array([1, 0])
                    : new Float32Array([0, 1])),
        };
        const without = await searchHybrid('祈禱', { store: s2, provider }, SETTINGS);
        expect(without[0]?.path).toBe('other.md');
        const withD = await searchHybrid(
            '祈禱', { store: s2, provider },
            { ...SETTINGS, synonyms: { 祈禱: ['禱告'] } },
        );
        expect(withD[0]?.path).toBe('sem-target.md');
    });

    it('the fuzzy-title leg keeps the raw query: expansion adds no title-only match', async () => {
        // A note whose TITLE is the synonym but whose content lacks it —
        // reachable only if the fuzzy leg saw the expanded query.
        store.upsertNote({
            path: 'titleonly.md', mtime: 1, title: '禱告', description: null, tier: 'hot',
            bodyVec: VEC, bodyDim: 2, indexedAt: 1, descVec: null,
        });
        store.upsertChunks('titleonly.md', [
            { notePath: 'titleonly.md', chunkIndex: 0, content: '完全無關的內文', vec: VEC },
        ]);
        const results = await searchHybrid(
            '祈禱', { store, provider: null },
            { ...SETTINGS, synonyms: { 祈禱: ['禱告'] } },
        );
        // target.md arrives via BM25 (content has 禱告); titleonly.md must
        // NOT arrive via fuzzy title, because fuzzy still sees only 祈禱.
        const paths = results.map(r => r.path);
        expect(paths).toContain('target.md');
        expect(paths).not.toContain('titleonly.md');
    });
});

describe('expandQuery hardening (1.7.0 review follow-ups)', () => {
    it('matches keys in folded space: dict spelled 計劃 fires on a 計畫 query', () => {
        expect(expandQuery('計畫', { 計劃: ['企劃案'] })).toBe('計畫 企劃案');
        expect(expandQuery('規畫書', { 規劃書: ['提案'] })).toBe('規畫書 提案');
        // and the reverse spelling direction
        expect(expandQuery('計劃', { 計畫: ['企劃案'] })).toBe('計劃 企劃案');
    });

    it('skips a value the query already covers in folded space', () => {
        // query says 計畫, value says 計劃 — same folded word, appending it
        // would only duplicate what BM25 already matches after 029.
        expect(expandQuery('計畫 進度', { 進度: ['計劃'] })).toBe('計畫 進度');
    });

    it('dedupes additions that fold to the same word', () => {
        expect(expandQuery('a', { a: ['計劃'], ab: ['計畫'] })).toBe('a 計劃');
    });

    it('an empty key never fires (red-team W2: hand-edited data.json)', () => {
        expect(expandQuery('anything at all', { '': ['INJECTED'] })).toBe('anything at all');
    });

    it('empty values are skipped', () => {
        expect(expandQuery('小陳', { 小陳: ['', '陳大文'] })).toBe('小陳 陳大文');
    });
});
