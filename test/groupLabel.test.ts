import { describe, it, expect } from 'vitest';
import {
    countTags,
    labelWidth,
    pickGroupLabel,
    stripDescriptionBoilerplate,
    truncateLabel,
} from '../src/canvas/groupLabel';

const counts = (o: Record<string, number>) => new Map(Object.entries(o));
const NONE = counts({});

describe('labelWidth（037 D3）', () => {
    it('counts CJK and full-width punctuation as 2, everything else as 1', () => {
        expect(labelWidth('神學')).toBe(4);
        expect(labelWidth('AI')).toBe(2);
        expect(labelWidth('讀書，神學')).toBe(10);
        expect(labelWidth('…')).toBe(1);
        expect(labelWidth(' · ')).toBe(3);
    });
});

describe('truncateLabel（037 D3）', () => {
    it('cuts to the longest prefix that fits with the ellipsis', () => {
        expect(truncateLabel('一二三四五六七八九十壹')).toBe('一二三四五六七八九…');
        expect(truncateLabel('machine-learning-basics-2026')).toBe('machine-learning-ba…');
    });

    it('keeps a label that is exactly at the limit', () => {
        expect(truncateLabel('一二三四五六七八九十')).toBe('一二三四五六七八九十');
    });
});

describe('stripDescriptionBoilerplate（037 D4）', () => {
    it('strips Traditional, Simplified and English openers', () => {
        expect(stripDescriptionBoilerplate('本文紀錄台北車站改建')).toBe('台北車站改建');
        expect(stripDescriptionBoilerplate('本筆記詳細說明：會議紀錄格式')).toBe('會議紀錄格式');
        expect(stripDescriptionBoilerplate('本文探讨台北车站')).toBe('台北车站');
        expect(stripDescriptionBoilerplate('这篇笔记介绍了会议流程')).toBe('会议流程');
        expect(stripDescriptionBoilerplate('This note describes the meeting format')).toBe('the meeting format');
    });

    it('returns "" when only the opener is left', () => {
        expect(stripDescriptionBoilerplate('This article explores  ')).toBe('');
    });

    it('leaves other text alone, after folding whitespace', () => {
        expect(stripDescriptionBoilerplate('台北車站改建')).toBe('台北車站改建');
        // Folding gives "本文 紀錄 台北"; the space breaks the opener, so it stays.
        expect(stripDescriptionBoilerplate('本文\n紀錄 台北')).toBe('本文 紀錄 台北');
    });
});

describe('countTags（037 D3）', () => {
    it('counts each note once per tag, case-insensitively, without #', () => {
        expect(countTags([['#讀書', '#讀書'], ['#讀書'], null])).toEqual(counts({ 讀書: 2 }));
        expect(countTags([['#AI'], ['#ai']])).toEqual(counts({ ai: 2 }));
    });
});

describe('pickGroupLabel（037 D3）', () => {
    it('puts the tag rarest on this canvas first, then adds a second that fits', () => {
        const label = pickGroupLabel(
            { tags: ['#讀書', '#神學'], description: undefined },
            counts({ 讀書: 3, 神學: 1 }), NONE,
        );
        expect(label).toBe('神學 · 讀書');
    });

    it('breaks canvas ties by vault count, then by the tag itself', () => {
        expect(pickGroupLabel(
            { tags: ['#甲', '#乙'], description: undefined },
            counts({ 甲: 1, 乙: 1 }), counts({ 甲: 9, 乙: 2 }),
        )).toBe('乙 · 甲');
        expect(pickGroupLabel(
            { tags: ['#b', '#a'], description: undefined },
            counts({ a: 1, b: 1 }), counts({ a: 5, b: 5 }),
        )).toBe('a · b');
    });

    it('drops the second tag when the pair would not fit', () => {
        expect(pickGroupLabel(
            { tags: ['#一二三四五六七八九', '#讀書'], description: undefined },
            counts({ 一二三四五六七八九: 1, 讀書: 2 }), NONE,
        )).toBe('一二三四五六七八九');
    });

    it('shows the last segment of a nested tag and skips a second with the same text', () => {
        expect(pickGroupLabel({ tags: ['#讀書/神學'], description: undefined }, NONE, NONE)).toBe('神學');
        expect(pickGroupLabel(
            { tags: ['#讀書/神學', '#課程/神學'], description: undefined },
            counts({ '讀書/神學': 1, '課程/神學': 1 }), NONE,
        )).toBe('神學');
    });

    it('dedupes case-insensitively and keeps the first spelling', () => {
        expect(pickGroupLabel({ tags: ['#AI', '#ai'], description: undefined }, NONE, NONE)).toBe('AI');
    });

    it('falls back to the description without its opener when there are no tags', () => {
        expect(pickGroupLabel(
            { tags: null, description: '本文紀錄台北車站改建工程進度與經費' }, NONE, NONE,
        )).toBe('台北車站改建工程進…');
        expect(pickGroupLabel({ tags: [], description: '會議紀錄' }, NONE, NONE)).toBe('會議紀錄');
    });

    it('returns null when nothing usable is left', () => {
        expect(pickGroupLabel({ tags: null, description: ['不是字串'] }, NONE, NONE)).toBeNull();
        expect(pickGroupLabel({ tags: null, description: 42 }, NONE, NONE)).toBeNull();
        expect(pickGroupLabel({ tags: null, description: '本文紀錄' }, NONE, NONE)).toBeNull();
        expect(pickGroupLabel({ tags: null, description: undefined }, NONE, NONE)).toBeNull();
    });
});
