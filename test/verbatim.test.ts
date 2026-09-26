import { describe, expect, it } from 'vitest';
import {
    applyVerbatimBoost,
    containsPhrase,
    foldAscii,
    hasHeadingLine,
    parseVerbatimQuery,
    titleStartsWith,
} from '../src/search/verbatim';

describe('parseVerbatimQuery', () => {
    it('needs at least two code points', () => {
        expect(parseVerbatimQuery('a')).toBeNull();
        expect(parseVerbatimQuery('😀')).toBeNull();
        expect(parseVerbatimQuery('""')).toBeNull();
        expect(parseVerbatimQuery('"台"')).toBeNull();
    });

    it('reads a plain query as-is and a double-quoted one as a phrase', () => {
        expect(parseVerbatimQuery('台北')).toEqual({ phrase: '台北', quoted: false });
        expect(parseVerbatimQuery('  會議  ')).toEqual({ phrase: '會議', quoted: false });
        expect(parseVerbatimQuery('"台北車站"')).toEqual({ phrase: '台北車站', quoted: true });
    });

    it('does not treat full-width brackets as quotes', () => {
        expect(parseVerbatimQuery('「台北車站」')).toEqual({ phrase: '「台北車站」', quoted: false });
    });
});

describe('foldAscii', () => {
    it('lowercases ASCII letters only', () => {
        expect(foldAscii('Plan A 台北 ÀB')).toBe('plan a 台北 Àb');
    });
});

describe('titleStartsWith', () => {
    it('matches the title or the title without its date prefix', () => {
        expect(titleStartsWith('20260329-LLM推理', 'LLM')).toBe(true);
        expect(titleStartsWith('2026-09-18 會議紀錄', '會議')).toBe(true);
        expect(titleStartsWith('LLM Guide', 'llm')).toBe(true);
        expect(titleStartsWith('會議紀錄', '紀錄')).toBe(false);
    });
});

describe('hasHeadingLine', () => {
    it('matches a whole heading line only', () => {
        expect(hasHeadingLine('x\n## 建議優先順序\ny', '建議優先順序')).toBe(true);
        expect(hasHeadingLine('## 建議優先順序（草稿）', '建議優先順序')).toBe(false);
        expect(hasHeadingLine('建議優先順序', '建議優先順序')).toBe(false);
        expect(hasHeadingLine('####### 太多', '太多')).toBe(false);
    });

    it('does not cross a line break or look inside code fences', () => {
        expect(hasHeadingLine('##\n建議優先順序', '建議優先順序')).toBe(false);
        expect(hasHeadingLine('```\n## 建議優先順序\n```', '建議優先順序')).toBe(false);
    });

    it('escapes regex characters and folds ASCII case', () => {
        expect(hasHeadingLine('## a+b', 'a+b')).toBe(true);
        expect(hasHeadingLine('## Plan A', 'plan a')).toBe(true);
    });
});

describe('containsPhrase', () => {
    it('needs whole words for an all-ASCII-word phrase', () => {
        expect(containsPhrase('we are planning', 'plan')).toBe(false);
        expect(containsPhrase('the plan is', 'plan')).toBe(true);
        expect(containsPhrase('maintain', 'ai')).toBe(false);
        expect(containsPhrase('Plan-A ready', 'plan-a')).toBe(true);
    });

    it('matches any substring otherwise', () => {
        expect(containsPhrase('會議紀錄整理', '紀錄')).toBe(true);
        expect(containsPhrase('會議紀錄整理', '台北')).toBe(false);
    });
});

describe('applyVerbatimBoost', () => {
    const bonus = 1 / 61;

    it('adds one first-place share to every hit and leaves the rest alone', () => {
        const fused = new Map([['a.md', 0.02], ['b.md', 0.03]]);
        const out = applyVerbatimBoost(fused, new Set(['a.md']));
        expect(out.get('a.md')).toBeCloseTo(0.02 + bonus, 12);
        expect(out.get('b.md')).toBe(0.03);
    });

    it('adds a hit that no leg found, starting from zero', () => {
        const out = applyVerbatimBoost(new Map([['a.md', 0.02]]), new Set(['c.md']));
        expect(out.get('c.md')).toBeCloseTo(bonus, 12);
    });

    it('does not modify its input', () => {
        const fused = new Map([['a.md', 0.02]]);
        applyVerbatimBoost(fused, new Set(['a.md']));
        expect(fused.get('a.md')).toBe(0.02);
    });
});
