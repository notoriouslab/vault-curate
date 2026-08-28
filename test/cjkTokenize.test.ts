import { describe, it, expect } from 'vitest';
import { tokenizeCJK } from '../src/storage/cjkTokenize';

describe('tokenizeCJK', () => {
    it('produces empty string for empty input', () => {
        expect(tokenizeCJK('')).toBe('');
    });

    it('lowercases pure ASCII words and preserves them', () => {
        expect(tokenizeCJK('Hello World')).toBe('hello world');
    });

    it('emits CJK trigrams sliding by one char', () => {
        // 主公在 → trigram '主公在'
        // 公在很 → trigram '公在很'
        // 等等。最後不足三字的尾巴：tail = '很好' → still emit one bigram-ish trigram '在很好' from offset 2
        const out = tokenizeCJK('主公在很好');
        // expected trigrams from each start position: 主公在, 公在很, 在很好
        expect(out).toBe('主公在 公在很 在很好');
    });

    it('mixes CJK trigrams + ASCII words correctly', () => {
        const out = tokenizeCJK('使用 Obsidian 寫筆記');
        // 使用 -> trigram '使用 ' or just '使用'? The CJK runs end at space.
        // Expectation per design: split CJK into trigrams within a CJK run; keep ASCII words intact.
        // '使用' is a 2-char CJK run -> emit single '使用' (no full trigram possible)
        // '寫筆記' is 3-char run -> '寫筆記'
        expect(out).toBe('使用 obsidian 寫筆記');
    });

    it('handles ASCII digits and dashes inside words', () => {
        expect(tokenizeCJK('GPT-4 model')).toBe('gpt-4 model');
    });

    it('skips punctuation but does not break trigram window', () => {
        // 中文 punctuation 中斷 CJK run，trigram only within each run
        const out = tokenizeCJK('主公，你好嗎？');
        // run1 = '主公' (2 chars) -> '主公'
        // run2 = '你好嗎' (3 chars) -> '你好嗎'
        expect(out).toBe('主公 你好嗎');
    });

    it('handles 4+ char CJK run with sliding trigrams', () => {
        // '一二三四' -> 一二三, 二三四
        expect(tokenizeCJK('一二三四')).toBe('一二三 二三四');
    });

    it('produces deterministic output (same input → same output)', () => {
        const input = '主公的 vault 有 LLM 筆記';
        expect(tokenizeCJK(input)).toBe(tokenizeCJK(input));
    });

    // 030: CJK_RE accidentally covered the surrogate block (U+8C48 vs U+F900
    // look-alike start of the second range), so emoji next to CJK were
    // absorbed into the run and trigrams carried lone surrogate halves.
    describe('surrogate fix (030)', () => {
        const wellFormed = (s: string) =>
            [...s.split(' ')].every((tok) => {
                for (let i = 0; i < tok.length; i++) {
                    const c = tok.charCodeAt(i);
                    if (c >= 0xd800 && c <= 0xdbff) {
                        const next = tok.charCodeAt(i + 1);
                        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
                        i++;
                    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
                }
                return true;
            });

        it('emoji between CJK breaks the run instead of polluting it', () => {
            expect(tokenizeCJK('中文😀測試')).toBe('中文 😀 測試');
        });

        it('emoji before / after CJK stays a clean standalone token', () => {
            expect(tokenizeCJK('😀中文')).toBe('😀 中文');
            expect(tokenizeCJK('中😀')).toBe('中 😀');
        });

        it('never emits a lone surrogate half (property over emoji mixes)', () => {
            const cases = ['中文😀測試', '🀄中文', '𠀀中文', '一二三四😀五六七八', '😀😀'];
            for (const c of cases) expect(wellFormed(tokenizeCJK(c))).toBe(true);
        });

        it('Hangul tokenization is unchanged (accidental coverage preserved)', () => {
            expect(tokenizeCJK('한글')).toBe('한글');
            expect(tokenizeCJK('한국어 공부')).toBe('한국어 공부');
        });

        it('CJK Extension B still emitted as a single token (version-2 path)', () => {
            expect(tokenizeCJK('𠀀')).toBe('𠀀');
        });
    });

    // 030: corpus-side bigram emission — the enumeration below IS the spec
    // (proposal T2); the default (query) mode must stay bigram-free.
    describe('bigram mode (030)', () => {
        const bi = (s: string) => tokenizeCJK(s, { bigrams: true });

        it('emits per-length exactly as specified', () => {
            expect(bi('台')).toBe('台');
            expect(bi('台北')).toBe('台北');
            expect(bi('台北靈')).toBe('台北靈 台北 北靈');
            expect(bi('台北靈糧')).toBe('台北靈 北靈糧 台北 北靈 靈糧');
            expect(bi('台北靈糧堂')).toBe('台北靈 北靈糧 靈糧堂 台北 北靈 靈糧 糧堂');
        });

        it('bigrams stay within run boundaries', () => {
            // punctuation splits runs — no bigram across 「，」
            expect(bi('台北，靈糧堂')).toBe('台北 靈糧堂 靈糧 糧堂');
        });

        it('ASCII words never emit bigrams', () => {
            expect(bi('obsidian 台北靈')).toBe('obsidian 台北靈 台北 北靈');
        });

        it('default mode is unchanged (no bigrams)', () => {
            expect(tokenizeCJK('台北靈糧堂')).toBe('台北靈 北靈糧 靈糧堂');
            expect(tokenizeCJK('台北靈')).toBe('台北靈');
        });
    });
});
