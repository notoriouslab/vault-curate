import { describe, it, expect } from 'vitest';
import { tokenizeForBM25, computeIdf, scoreBM25, type BM25Doc } from '../src/storage/bm25';

describe('bm25', () => {
    describe('tokenizeForBM25', () => {
        it('handles pure ASCII', () => {
            expect(tokenizeForBM25('Hello World')).toEqual(['hello', 'world']);
        });

        it('produces CJK trigrams for Chinese', () => {
            const tokens = tokenizeForBM25('主公在很好');
            expect(tokens).toEqual(['主公在', '公在很', '在很好']);
        });

        it('mixes CJK + ASCII', () => {
            const tokens = tokenizeForBM25('使用 Obsidian 寫筆記');
            // 029: tokens are variant-folded (t2s pivot) — 寫筆記 → 写笔记.
            // Both corpus and query sides fold identically, so tokens only
            // ever meet other folded tokens; the raw form never leaks out.
            expect(tokens).toEqual(['使用', 'obsidian', '写笔记']);
        });

        it('returns empty for empty input', () => {
            expect(tokenizeForBM25('')).toEqual([]);
        });
    });

    describe('computeIdf', () => {
        it('returns higher IDF for rarer terms', () => {
            const docs: BM25Doc[] = [
                { id: '1', tokens: ['cat', 'sat', 'mat'] },
                { id: '2', tokens: ['dog', 'sat', 'mat'] },
                { id: '3', tokens: ['bird', 'sat'] },
            ];
            const idf = computeIdf(['cat', 'sat'], docs);
            const idfCat = idf.get('cat')!;
            const idfSat = idf.get('sat')!;
            expect(idfCat).toBeGreaterThan(idfSat); // 'cat' appears in 1/3 docs, 'sat' in 3/3
        });

        it('returns 0 IDF for terms in every doc', () => {
            const docs: BM25Doc[] = [
                { id: '1', tokens: ['a', 'b'] },
                { id: '2', tokens: ['a', 'c'] },
            ];
            const idf = computeIdf(['a'], docs);
            // standard BM25+ formula: ln((N - df + 0.5) / (df + 0.5) + 1)
            // df = N = 2 → ln((2-2+0.5)/(2+0.5) + 1) = ln(1.2) ≈ 0.182
            expect(idf.get('a')!).toBeGreaterThan(0);
            expect(idf.get('a')!).toBeLessThan(0.5);
        });

        it('handles empty queries gracefully', () => {
            const docs: BM25Doc[] = [{ id: '1', tokens: ['a'] }];
            expect(computeIdf([], docs).size).toBe(0);
        });
    });

    describe('scoreBM25', () => {
        it('returns 0 for docs containing no query terms', () => {
            const docs: BM25Doc[] = [
                { id: '1', tokens: ['cat', 'sat'] },
                { id: '2', tokens: ['dog', 'ran'] },
            ];
            const idf = computeIdf(['xyz'], docs);
            const hits = scoreBM25(['xyz'], docs, idf, 10);
            expect(hits.length).toBe(0);
        });

        it('ranks docs with more query term matches higher', () => {
            const docs: BM25Doc[] = [
                { id: 'a', tokens: ['cat', 'sat', 'mat'] },
                { id: 'b', tokens: ['cat', 'cat', 'cat'] },
                { id: 'c', tokens: ['dog', 'ran'] },
            ];
            const q = ['cat'];
            const idf = computeIdf(q, docs);
            const hits = scoreBM25(q, docs, idf, 10);
            // doc 'b' (3 hits of 'cat') should score above 'a' (1 hit) due to BM25 saturation
            expect(hits[0].id).toBe('b');
            expect(hits[1].id).toBe('a');
            expect(hits.find((h) => h.id === 'c')).toBeUndefined();
        });

        it('honours limit parameter', () => {
            const docs: BM25Doc[] = Array.from({ length: 50 }, (_, i) => ({
                id: String(i),
                tokens: ['target'],
            }));
            const idf = computeIdf(['target'], docs);
            const hits = scoreBM25(['target'], docs, idf, 5);
            expect(hits.length).toBe(5);
        });

        it('works for Chinese query via tokenizeForBM25 input', () => {
            const docs: BM25Doc[] = [
                { id: 'a', tokens: tokenizeForBM25('主公在 Obsidian 寫關於 LLM 的筆記') },
                { id: 'b', tokens: tokenizeForBM25('今天天氣很好出去散步') },
            ];
            const q = tokenizeForBM25('LLM 筆記');
            const idf = computeIdf(q, docs);
            const hits = scoreBM25(q, docs, idf, 10);
            expect(hits.length).toBe(1);
            expect(hits[0].id).toBe('a');
        });
    });
});
