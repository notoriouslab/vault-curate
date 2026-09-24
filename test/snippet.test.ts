import { describe, it, expect } from 'vitest';
import { buildSnippet, SNIPPET_WINDOW } from '../src/search/snippet';
import { tokenizeForBM25 } from '../src/storage/bm25';
import { stripChunkPrefix } from '../src/indexer/tokenChunker';
import type { SearchSnippet } from '../src/types';

const W = { bm25: 1, semantic: 1 };
const K = 60;
const base = {
    bm25Rank: null, semanticRank: null, bm25Real: null, bm25Desc: null, semantic: null,
    weights: W, k: K, chunkCount: 3,
};
const hl = (s: SearchSnippet) => s.ranges.map(([a, b]) => s.text.slice(a, b));
const cps = (s: string) => [...s].length;

describe('buildSnippet', () => {
    it('(a) uses the BM25 chunk when that leg contributes more, highlighting the query', () => {
        const s = buildSnippet({
            ...base,
            queryTokens: tokenizeForBM25('登山裝備'),
            bm25Rank: 1, semanticRank: 5,
            bm25Real: { chunkIndex: 2, content: '後段才提到登山裝備要帶頭燈' },
            semantic: { chunkIndex: 0, content: '開頭寫天氣' },
        })!;
        expect(s.source).toBe('bm25');
        expect(s.chunkIndex).toBe(2);
        // Overlapping trigram hits merge into one range covering the phrase.
        expect(hl(s)).toEqual(['登山裝備']);
    });

    it('(b) uses the semantic chunk head when that leg contributes more', () => {
        const s = buildSnippet({
            ...base,
            queryTokens: tokenizeForBM25('夕陽'),
            bm25Rank: 9, semanticRank: 1,
            bm25Real: { chunkIndex: 1, content: '別處提到夕陽' },
            semantic: { chunkIndex: 0, content: '傍晚去河堤散步看夕陽' },
        })!;
        expect(s.source).toBe('semantic');
        expect(s.text.startsWith('傍晚去河堤')).toBe(true);
        expect(s.anchor).toBe('傍晚去河堤散步看夕陽');
    });

    it('(c) falls back to the description when only it matched', () => {
        const s = buildSnippet({
            ...base,
            queryTokens: tokenizeForBM25('登山裝備'),
            bm25Rank: 1,
            bm25Desc: { content: '這篇整理登山裝備的採購清單' },
        })!;
        expect(s.source).toBe('description');
        expect(s.anchor).toBeNull();
        expect(s.chunkIndex).toBeNull();
        expect(s.chunkCount).toBeNull();
    });

    it('(d) prefers a real chunk over the description', () => {
        const s = buildSnippet({
            ...base,
            queryTokens: tokenizeForBM25('登山'),
            bm25Rank: 1,
            bm25Real: { chunkIndex: 0, content: '內文談登山' },
            bm25Desc: { content: '描述也談登山' },
        })!;
        expect(s.source).toBe('bm25');
        expect(s.text).toBe('內文談登山');
    });

    it('(e) keeps highlights aligned after characters whose simplified form changes UTF-16 length', () => {
        const content = '㑮㑮㑮前文，這裡是目標詞，後文';
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('目標詞'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect(hl(s).join('')).toBe('目標詞');
    });

    it('(f) highlights a variant spelling in the original text', () => {
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('計畫'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content: '年度計劃已送出' } })!;
        expect(hl(s)).toEqual(['計劃']);
    });

    it('(g) matches ASCII tokens as whole words only', () => {
        const s = buildSnippet({ ...base, queryTokens: ['ai'], bm25Rank: 1, bm25Real: { chunkIndex: 0, content: 'maintain the AI tools' } })!;
        expect(hl(s)).toEqual(['AI']);
    });

    it('(h) opens at the body head when the query only hit the title prefix', () => {
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('標題詞'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content: '內文完全沒有那個詞' } })!;
        expect(s.source).toBe('bm25');
        expect(s.text).toBe('內文完全沒有那個詞');
        expect(s.ranges).toEqual([]);
    });

    it('(i) keeps a window around a hit near the end inside the content', () => {
        const content = '字'.repeat(500) + '終點詞';
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('終點詞'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect(cps(s.text)).toBeLessThanOrEqual(SNIPPET_WINDOW);
        expect(s.text.endsWith('終點詞')).toBe(true);
    });

    it('(j) returns null when neither leg matched', () => {
        expect(buildSnippet({ ...base, queryTokens: tokenizeForBM25('什麼') })).toBeNull();
    });

    it('(k) survives a truncated long-title prefix: the anchor points into the body', () => {
        const title = '乙'.repeat(80);
        const body = '本文第一句在這裡，後面還有內容';
        const chunk = '乙'.repeat(64) + '\n' + body;
        const s = buildSnippet({
            ...base, queryTokens: tokenizeForBM25('無關'), semanticRank: 1,
            semantic: { chunkIndex: 0, content: stripChunkPrefix(chunk, title) },
        })!;
        expect(body.indexOf(s.anchor!)).toBe(0);
        expect(s.anchor!.includes('乙')).toBe(false);
    });

    it('(l) folds whitespace and CRLF, trims the ends, and keeps ranges on the right text', () => {
        const content = '  第一行\r\n\r\n   第二行有關鍵詞  \t 結尾  ';
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('關鍵詞'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect(s.text).toBe('第一行 第二行有關鍵詞 結尾');
        expect(hl(s).join('')).toBe('關鍵詞');
    });

    it('(m) weighs a description-only BM25 hit against the semantic leg', () => {
        const input = {
            ...base, queryTokens: tokenizeForBM25('登山'),
            bm25Desc: { content: '描述談登山' },
            semantic: { chunkIndex: 1, content: '語意相近的登山段落' },
        };
        expect(buildSnippet({ ...input, bm25Rank: 1, semanticRank: 8 })!.source).toBe('description');
        expect(buildSnippet({ ...input, bm25Rank: 8, semanticRank: 1 })!.source).toBe('semantic');
    });

    it('(n) anchors a BM25 snippet at the hit so a jump lands on that line', () => {
        const content = '前面有很長的一段鋪陳文字。中間這裡寫到頭燈與雨衣。' + '後面還有很多描述裝備細節的內容'.repeat(4);
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('頭燈'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect(s.anchor!.startsWith('頭燈')).toBe(true);
        expect(content.includes(s.anchor!)).toBe(true);
        expect(s.anchorRatio).toBeCloseTo(content.indexOf('頭燈') / content.length, 5);
    });

    it('(o) reaches back for a full-length anchor when the hit is near the chunk end', () => {
        const content = '字'.repeat(100) + '結尾提到頭燈';
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('頭燈'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect([...s.anchor!].length).toBe(40);
        expect(s.anchor!.endsWith('結尾提到頭燈')).toBe(true);
    });

    it('(p) does not treat half a word at the window edge as a whole word', () => {
        // The window opens 20 code points before the hit: here that is the "a"
        // of "xai", so the cropped text starts with "ai…".
        const content = '中'.repeat(50) + 'xai' + '中'.repeat(17) + ' AI ' + '中'.repeat(100);
        const s = buildSnippet({ ...base, queryTokens: ['ai'], bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect(s.text.startsWith('ai')).toBe(true);
        expect(hl(s)).toEqual(['AI']);
    });

    it('(q) gives no snippet for a chunk with no body, so the row keeps its preview', () => {
        expect(buildSnippet({ ...base, queryTokens: tokenizeForBM25('登山'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content: '   \n ' } })).toBeNull();
        const s = buildSnippet({
            ...base, queryTokens: tokenizeForBM25('登山'), bm25Rank: 1, semanticRank: 2,
            bm25Real: { chunkIndex: 0, content: '' }, semantic: { chunkIndex: 1, content: '另一段有內容' },
        })!;
        expect(s.source).toBe('semantic');
    });

    it('(r) ignores single-character tokens when a longer token matched', () => {
        const content = '我用了很多工具，用過就忘，最後才學會用AI做筆記的方法';
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('用AI做筆記'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        // Adjacent hits merge; the lone 用 hits earlier in the text are ignored.
        expect(hl(s)).toEqual(['AI做筆記']);
        expect(s.anchor).toContain('AI');
    });

    it('(s) keeps a BM25 hit near the start of the text (rows show three lines)', () => {
        const content = '字'.repeat(300) + '目標詞' + '字'.repeat(300);
        const s = buildSnippet({ ...base, queryTokens: tokenizeForBM25('目標詞'), bm25Rank: 1, bm25Real: { chunkIndex: 0, content } })!;
        expect(s.text.indexOf('目標詞')).toBe(20);
    });

    it('(t) shows the passage with the query words when the leading leg has none', () => {
        // A name query: the note ranked on semantic similarity, but only the
        // BM25 chunk actually contains the name.
        const s = buildSnippet({
            ...base, queryTokens: tokenizeForBM25('梅花'), bm25Rank: 3, semanticRank: 1,
            bm25Real: { chunkIndex: 0, content: '前文提到梅花開了' },
            semantic: { chunkIndex: 1, content: '後段談搜尋系統的設計取捨' },
        })!;
        expect(s.source).toBe('bm25');
        expect(hl(s)).toEqual(['梅花']);
    });
});
