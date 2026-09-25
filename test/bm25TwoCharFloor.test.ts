import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    tokenizeForBM25,
    tokenizeForBM25Corpus,
    buildBM25Index,
    searchBM25Index,
} from '../src/storage/bm25';

/**
 * 030 T3(a): the two-char query floor, unit layer.
 *
 * Before 030, a 2-char CJK query emitted a single 2-char token that could
 * never match the 3-char trigrams of longer corpus runs — `台北` missed
 * every note that only writes 台北體育館. Corpus-side bigram emission
 * (tokenizeForBM25Corpus) closes that floor; the query side stays as-is.
 */
describe('bm25 two-char floor (030)', () => {
    // Embedded-form fixtures: the 2-char term appears ONLY inside longer runs.
    const fixtures: Array<{ id: string; text: string; query: string }> = [
        { id: 'a', text: '今天去台北體育館聚會', query: '台北' },
        { id: 'b', text: '金管會發布新的監管框架', query: '金管' },
        { id: 'c', text: '智慧詩歌選用顧問系統', query: '智慧' },
        { id: 'd', text: '搜尋系統品質測試報告', query: '搜尋' },
        { id: 'e', text: '人生導師的提示詞設計', query: '人生' },
    ];
    const others = [
        { id: 'x', text: '完全無關的一篇筆記內容' },
        { id: 'y', text: 'pure english note about nothing' },
    ];
    const corpus = [...fixtures, ...others].map((f) => ({
        id: f.id,
        tokens: tokenizeForBM25Corpus(f.text),
    }));
    const index = buildBM25Index(corpus);

    it('each embedded 2-char query now hits its note', () => {
        for (const f of fixtures) {
            const hits = searchBM25Index(index, tokenizeForBM25(f.query), 10);
            expect(hits.map((h) => h.id), `query ${f.query}`).toContain(f.id);
        }
    });

    it('standalone 2-char runs keep matching (regression)', () => {
        const docs = [{ id: 's', tokens: tokenizeForBM25Corpus('台北 一日遊') }];
        const hits = searchBM25Index(buildBM25Index(docs), tokenizeForBM25('台北'), 10);
        expect(hits.map((h) => h.id)).toContain('s');
    });

    it('unrelated notes are not dragged in by a 2-char query', () => {
        const hits = searchBM25Index(index, tokenizeForBM25('台北'), 10);
        expect(hits.map((h) => h.id)).not.toContain('y');
    });

    // Proposal T2 forbidden zone: the query path must never emit bigrams.
    // Mutation self-check partner: wiring the query side to the corpus
    // tokenizer makes ≥3-char query runs emit extra bigram tokens — this
    // assertion is the tripwire.
    it('query tokenization never emits bigrams', () => {
        expect(tokenizeForBM25('台北體育館')).toEqual(['台北体', '北体育', '体育馆']);
        expect(tokenizeForBM25('台北')).toEqual(['台北']);
    });

    // Wiring-level tripwire for the same forbidden zone: the function-level
    // assertion above can't see SQLiteStore's call site, so pin it in source.
    // (grep-gate pattern; searchBM25 is the only query-path tokenize call.)
    it('SQLiteStore query path is wired to the bigram-free tokenizer', () => {
        const src = readFileSync(
            join(__dirname, '../src/storage/SQLiteStore.ts'),
            'utf-8',
        );
        expect(src).toContain('const queryTokens = tokenizeForBM25(query);');
        expect(src).not.toContain('tokenizeForBM25Corpus(query)');
    });

    it('corpus and query tokenization agree on the folded space (029 carry-over)', () => {
        // corpus bigrams are emitted AFTER variant folding, so a 規畫 query
        // (folds to 规划) reaches 規劃書 written with the other variant.
        const docs = [{ id: 'v', tokens: tokenizeForBM25Corpus('年度規劃書草稿') }];
        const hits = searchBM25Index(buildBM25Index(docs), tokenizeForBM25('規畫'), 10);
        expect(hits.map((h) => h.id)).toContain('v');
    });
});
