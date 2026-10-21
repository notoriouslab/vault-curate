import { describe, it, expect } from 'vitest';
import {
    estimateTokens,
    sampleSpread,
    SAMPLE_SEP,
    stripUrlsForLlm,
} from '../src/utils/llmSample';
import { sampleForLlm } from '../src/description-generator';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('estimateTokens (040 D1)', () => {
    it('weighs letters and spaces 0.3, other ASCII and BMP 1.0, astral 2.0', () => {
        expect(estimateTokens('abc')).toBeCloseTo(0.9);
        expect(estimateTokens('a b')).toBeCloseTo(0.9);
        // Digits and symbols tokenize near one per char (040 review).
        expect(estimateTokens('2025-01-10')).toBe(10);
        expect(estimateTokens('x[0]')).toBeCloseTo(3.3);
        expect(estimateTokens('中文')).toBe(2);
        expect(estimateTokens('かな')).toBe(2);
        expect(estimateTokens('Привет')).toBe(6);
        expect(estimateTokens('😀')).toBe(2);
    });
});

describe('stripUrlsForLlm (040 D1)', () => {
    it('drops data URIs but keeps prose that says data: (040 review)', () => {
        expect(stripUrlsForLlm('a<img src="data:image/png;base64,iVBORw0KGgo+/=">b')).toBe('a<img src="">b');
        expect(stripUrlsForLlm('x data:text/plain;charset=utf-8,hello y')).toBe('x  y');
        expect(stripUrlsForLlm('Raw data: 12 rows')).toBe('Raw data: 12 rows');
        expect(stripUrlsForLlm('metadata:title and data:2025')).toBe('metadata:title and data:2025');
        // Only real media types, and the URI stops at non-ASCII like bare URLs.
        expect(stripUrlsForLlm('load data:sales/q3,q4 and compare')).toBe('load data:sales/q3,q4 and compare');
        expect(stripUrlsForLlm('圖片data:image/png;base64,iVBOR後面的中文')).toBe('圖片後面的中文');
    });

    it('drops images and bare URLs, keeps link text', () => {
        expect(stripUrlsForLlm('![](https://x/y.png)a')).toBe('a');
        expect(stripUrlsForLlm('[文字](https://x)')).toBe('文字');
        expect(stripUrlsForLlm('[t](obsidian://open?x)')).toBe('t');
        expect(stripUrlsForLlm('see <https://x> ok')).toBe('see  ok');
        expect(stripUrlsForLlm('go https://x.com/a?b=1 now')).toBe('go  now');
    });

    it('stops a bare URL at the first non-ASCII character', () => {
        expect(stripUrlsForLlm('見 https://x.com/a。接下來說明')).toBe('見 。接下來說明');
    });

    it('leaves wikilinks alone', () => {
        expect(stripUrlsForLlm('[[Wiki]]')).toBe('[[Wiki]]');
    });

    it('known limits: task checkboxes and trailing punctuation (LLM input only)', () => {
        expect(stripUrlsForLlm('- [ ] todo')).toBe('-  todo');
        expect(stripUrlsForLlm('see (https://x.com/a), then')).toBe('see ( then');
    });
});

describe('sampleSpread (040 D1)', () => {
    it('returns short text unchanged', () => {
        expect(sampleSpread('短文')).toBe('短文');
    });

    it('keeps long English within budget in six segments', () => {
        const out = sampleSpread('word '.repeat(5000));
        expect(estimateTokens(out)).toBeLessThanOrEqual(3000 + 1e-9);
        expect(out.split(SAMPLE_SEP).length).toBe(6);
    });

    it('keeps long Chinese within budget', () => {
        const out = sampleSpread('字'.repeat(10000));
        expect(estimateTokens(out)).toBeLessThanOrEqual(3000 + 1e-9);
    });

    it('never lets a segment run into the next one', () => {
        // Unique content at every position, so indexOf pins each segment.
        // Low-density ASCII first: an unclamped sampler overlaps here (G1 round 5).
        const text = Array.from({ length: 1000 }, (_, i) => `w${String(i).padStart(4, '0')} `).join('')
            + Array.from({ length: 3000 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
        const segs = sampleSpread(text).split(SAMPLE_SEP);
        expect(segs.length).toBe(6);
        let prevEnd = 0;
        for (const seg of segs) {
            const start = text.indexOf(seg);
            expect(start).toBeGreaterThanOrEqual(prevEnd);
            prevEnd = start + seg.length;
        }
    });

    it('never splits a surrogate pair', () => {
        const out = sampleSpread('😀'.repeat(20000));
        expect(LONE_SURROGATE.test(out)).toBe(false);
    });
});

describe('sampleForLlm (040 D1)', () => {
    it('removes URLs before sending text to the LLM', () => {
        const body = Array.from({ length: 30 }, (_, i) =>
            `Paragraph ${i} talks about trail maps. ![](https://img.example/p${i}.png) More text here.`).join('\n\n');
        expect(sampleForLlm(body)).not.toContain('https://');
    });
});
