/**
 * 029: variant-character folding in the BM25 leg.
 *
 * The real-vault failure this pins: 規劃/規畫 split 90:114 in the same
 * corpus, and a 規畫書 query found 1 of 10 規劃書 notes — the keyword leg
 * treated two spellings of one word as different worlds while the semantic
 * leg (t2s since 008) already merged them. Folding happens inside
 * tokenizeForBM25, so corpus and query sides can never disagree.
 *
 * Also pinned: the adversarial side. t2s merges DISTINCT traditional chars
 * (發/髮→发, 面/麵→面, 里/裡→里) — a false merge must not surface documents
 * the raw query could never intend. The trigram window bounds this (22-probe
 * pilot on the real corpus: 0 perturbed); the cases here keep it bounded.
 */
import { describe, it, expect } from 'vitest';
import {
    tokenizeForBM25,
    normalizeForSearch,
    buildBM25Index,
    searchBM25Index,
} from '../src/storage/bm25';

const index = (docs: Array<[string, string]>) =>
    buildBM25Index(docs.map(([id, text]) => ({ id, tokens: tokenizeForBM25(text) })));

const hits = (idx: ReturnType<typeof buildBM25Index>, q: string) =>
    searchBM25Index(idx, tokenizeForBM25(q), 10).map((h) => h.id);

describe('normalizeForSearch (029)', () => {
    it('folds the t2s variant classes the pilot measured', () => {
        // 臺/台, 裏/裡, 爲/為, 綫/線 — merged via the t2s pivot
        expect(normalizeForSearch('臺北')).toBe(normalizeForSearch('台北'));
        expect(normalizeForSearch('這裏')).toBe(normalizeForSearch('這裡'));
        expect(normalizeForSearch('爲何')).toBe(normalizeForSearch('為何'));
        expect(normalizeForSearch('斷綫')).toBe(normalizeForSearch('斷線'));
    });

    it('folds 劃/畫 via the patch (Simplified alone keeps them apart)', () => {
        expect(normalizeForSearch('規劃書')).toBe(normalizeForSearch('規畫書'));
        expect(normalizeForSearch('計劃')).toBe(normalizeForSearch('計畫'));
    });

    it('leaves ASCII untouched', () => {
        expect(normalizeForSearch('GPT-4 benchmark')).toBe('GPT-4 benchmark');
    });
});

describe('BM25 variant bridging (029)', () => {
    it('規畫書 query finds 規劃書 documents (the real-vault miss)', () => {
        const idx = index([
            ['a', '這是一份完整的系統重整規劃書，涵蓋三個階段'],
            ['b', '專案規劃書初稿已經完成'],
            ['c', '今天天氣很好'],
        ]);
        expect(hits(idx, '規畫書')).toEqual(expect.arrayContaining(['a', 'b']));
        expect(hits(idx, '規畫書')).not.toContain('c');
        // and the reverse direction
        const idx2 = index([['d', '導入規畫書的第二版']]);
        expect(hits(idx2, '規劃書')).toContain('d');
    });

    it('臺北 query finds an isolated 台北 run (2-char floor still applies)', () => {
        const idx = index([
            ['iso', '我住在 台北 這座城市'],   // isolated 2-char run — reachable
            ['long', '台北靈糧堂的聚會紀錄'],   // embedded in a 5-char run — trigram floor
        ]);
        const r = hits(idx, '臺北');
        expect(r).toContain('iso');
        // Honest boundary, pinned so a future fix shows up as a test change:
        expect(r).not.toContain('long');
    });

    it('query and corpus sides can never disagree (both go through tokenizeForBM25)', () => {
        expect(tokenizeForBM25('規劃書')).toEqual(tokenizeForBM25('規畫書'));
        expect(tokenizeForBM25('臺北')).toEqual(tokenizeForBM25('台北'));
    });
});

describe('false-merge containment (029 adversarial)', () => {
    it('發/髮 merge cannot surface an unrelated doc: trigram context must also match', () => {
        const idx = index([
            ['hair', '她的頭髮很長很漂亮'],
            ['depart', '明天一早出發前往台中'],
        ]);
        // 頭髮 → 头发; 出發 → 出发 — merged CHAR, but the 2-char query tokens
        // 头发 vs 出发 stay distinct, so neither query reaches the other doc.
        expect(hits(idx, '頭髮')).not.toContain('depart');
        expect(hits(idx, '出發')).not.toContain('hair');
    });

    it('面/麵 merge stays contained the same way', () => {
        const idx = index([
            ['noodle', '這家的牛肉麵包你滿意'],
            ['surface', '物體表面很光滑'],
        ]);
        expect(hits(idx, '表面')).not.toContain('noodle');
    });

    it('non-variant queries are untouched: identical ids and scores', () => {
        const docs: Array<[string, string]> = [
            ['x', '台積電法說會的第二季財報數字'],
            ['y', '提示詞工程的基本原則'],
            ['z', '完全無關的一篇筆記'],
        ];
        const idx = index(docs);
        // A raw index built WITHOUT folding must agree on these queries.
        const rawIdx = buildBM25Index(docs.map(([id, text]) => {
            const s = text; // raw: no normalizeForSearch
            return { id, tokens: s ? tokenizeForBM25AsRaw(s) : [] };
        }));
        for (const q of ['台積電', '提示詞']) {
            const folded = searchBM25Index(idx, tokenizeForBM25(q), 10);
            const raw = searchBM25Index(rawIdx, tokenizeForBM25AsRaw(q), 10);
            expect(folded.map(h => h.id)).toEqual(raw.map(h => h.id));
            folded.forEach((h, i) => expect(h.score).toBeCloseTo(raw[i].score, 12));
        }
    });
});

/** Raw tokenization (pre-029 behavior) for the control comparison above —
 *  reimplemented from tokenizeCJK without the folding step. */
import { tokenizeCJK } from '../src/storage/cjkTokenize';
function tokenizeForBM25AsRaw(text: string): string[] {
    const s = tokenizeCJK(text);
    return s ? s.split(' ').filter((t) => t.length > 0) : [];
}
