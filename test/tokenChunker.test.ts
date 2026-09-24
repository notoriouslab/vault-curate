import { describe, it, expect } from 'vitest';
import { splitChunks } from '../src/indexer/chunker';
import {
    splitChunksByTokens,
    chunkTitlePrefix,
    stripChunkPrefix,
    type TokenChunkOptions,
} from '../src/indexer/tokenChunker';

// One code point = one token, plus [CLS] and [SEP].
const count = (s: string) => [...s].length + 2;
const opts = (over: Partial<TokenChunkOptions> = {}): TokenChunkOptions => ({
    maxTokens: 100,
    overlapChars: 10,
    maxWindowChars: 2000,
    maxTitleChars: 64,
    ...over,
});
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Strip each chunk's prefix, then undo the overlap the splitter applied:
 *  chunk i+1 starts `min(overlapChars, floor(L_i / 2))` code points before
 *  chunk i ends, where L_i is chunk i's slice length. */
function reassemble(contents: string[], prefix: string, overlapChars: number): string {
    const slices = contents.map((c) => [...c.slice(prefix.length)]);
    let out = slices[0].join('');
    for (let i = 1; i < slices.length; i++) {
        const ov = Math.min(overlapChars, Math.floor(slices[i - 1].length / 2));
        out += slices[i].slice(ov).join('');
    }
    return out;
}

describe('splitChunksByTokens', () => {
    it('1. matches splitChunks for empty body, empty title and whitespace-only body', () => {
        const cases: Array<[string, string]> = [['', 'Title'], ['abc', ''], ['   \n ', 'Title']];
        for (const [body, title] of cases) {
            expect(splitChunksByTokens(body, title, count, opts()))
                .toEqual(splitChunks(body, title, { chunkSize: 2000, chunkOverlap: 100 }));
        }
    });

    it('2. returns a single chunk when the whole body fits', () => {
        const chunks = splitChunksByTokens('  short body  ', 'Title', count, opts());
        expect(chunks).toEqual([{ content: 'Title\nshort body', chunkIndex: 0 }]);
    });

    it('3a. covers the whole body without gaps (no punctuation)', () => {
        const body = Array.from({ length: 1000 }, (_, i) => String.fromCharCode(0x4e00 + (i % 500))).join('');
        const chunks = splitChunksByTokens(body, '', count, opts());
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(count(c.content)).toBeLessThanOrEqual(100);
        expect(reassemble(chunks.map((c) => c.content), '', 10)).toBe(body);
    });

    it('3b. covers the whole body without gaps (a full stop every 30 code points)', () => {
        const body = Array.from({ length: 1000 }, (_, i) =>
            i % 30 === 29 ? '。' : String.fromCharCode(0x4e00 + (i % 500))).join('');
        const chunks = splitChunksByTokens(body, '', count, opts());
        for (const c of chunks) expect(count(c.content)).toBeLessThanOrEqual(100);
        expect(reassemble(chunks.map((c) => c.content), '', 10)).toBe(body);
    });

    it('4. overlaps adjacent chunks by min(overlapChars, floor(L/2))', () => {
        const body = 'x'.repeat(40) + 'y'.repeat(300) + 'z'.repeat(40);
        const chunks = splitChunksByTokens(body, '', count, opts());
        for (let i = 1; i < chunks.length; i++) {
            const prev = [...chunks[i - 1].content];
            const ov = Math.min(10, Math.floor(prev.length / 2));
            const tail = prev.slice(prev.length - ov).join('');
            expect(chunks[i].content.startsWith(tail)).toBe(true);
        }
    });

    it('5. truncates a long title and keeps the chunk count bounded', () => {
        const title = 'T'.repeat(200);
        const body = 'b'.repeat(2000);
        const chunks = splitChunksByTokens(body, title, count, opts());
        const prefix = 'T'.repeat(64) + '\n';
        for (const c of chunks) expect(c.content.startsWith(prefix)).toBe(true);
        expect(chunks.length).toBeLessThanOrEqual(Math.ceil(2000 / Math.floor((100 - 2 - 65) / 2)));
    }, 2000);

    it('6. never exceeds maxTokens under a non-monotonic counter', () => {
        const bumpy = (s: string) => {
            const n = [...s].length;
            return n + 2 + (n % 11 === 0 ? 3 : 0);
        };
        const body = 'abcdefghij'.repeat(80);
        const chunks = splitChunksByTokens(body, 'Title', bumpy, opts());
        for (const c of chunks) expect(bumpy(c.content)).toBeLessThanOrEqual(100);
    });

    it('7. never splits a surrogate pair', () => {
        const body = ('a'.repeat(95) + '😀😀😀' + 'b'.repeat(50)).repeat(4);
        const chunks = splitChunksByTokens(body, '', count, opts());
        for (const c of chunks) expect(LONE_SURROGATE.test(c.content)).toBe(false);
    });

    it('8. prefers to end a window right after a sentence boundary', () => {
        // max 102 with an empty title lets the first window reach 100 code points;
        // a full stop sits at code point 90 (index 89), inside [80, 100].
        const chars = Array.from({ length: 300 }, () => '字');
        chars[89] = '。';
        const chunks = splitChunksByTokens(chars.join(''), '', count, opts({ maxTokens: 102 }));
        expect([...chunks[0].content].length).toBe(90);
        expect(chunks[0].content.endsWith('。')).toBe(true);
    });

    it('9. numbers chunks from 0 without gaps', () => {
        const chunks = splitChunksByTokens('字'.repeat(900), 'T', count, opts());
        expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    });
});

describe('chunkTitlePrefix', () => {
    it('10. handles empty, newline, short, long and emoji titles', () => {
        expect(chunkTitlePrefix('', 64)).toBe('');
        expect(chunkTitlePrefix('a\nb', 64)).toBe('a b\n');
        const short = '甲'.repeat(30);
        expect(chunkTitlePrefix(short, 64)).toBe(short + '\n');
        const long = '乙'.repeat(80);
        expect(chunkTitlePrefix(long, 64)).toBe('乙'.repeat(64) + '\n');
        const emoji = '丙'.repeat(63) + '😀' + '丁'.repeat(5);
        const p = chunkTitlePrefix(emoji, 64);
        expect(p).toBe('丙'.repeat(63) + '😀\n');
        expect(LONE_SURROGATE.test(p)).toBe(false);
    });
});

describe('stripChunkPrefix', () => {
    const long = '乙'.repeat(80);

    it('11a. strips the truncated prefix of a token-policy chunk', () => {
        expect(stripChunkPrefix('乙'.repeat(64) + '\n本文', long)).toBe('本文');
    });

    it('11b. strips the full-title prefix of a char-policy chunk', () => {
        expect(stripChunkPrefix(long + '\n本文', long)).toBe('本文');
    });

    it('11c. strips a short title', () => {
        expect(stripChunkPrefix('短標題\n本文', '短標題')).toBe('本文');
    });

    it('11d. leaves content without any matching prefix untouched', () => {
        expect(stripChunkPrefix('別的內容', '短標題')).toBe('別的內容');
    });

    it('11e. strips a raw multi-line title written by the char splitter', () => {
        expect(stripChunkPrefix('a\nb\n本文', 'a\nb')).toBe('本文');
    });
});
