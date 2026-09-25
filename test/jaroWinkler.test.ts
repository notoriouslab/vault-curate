import { describe, it, expect } from 'vitest';
import { jaro, jaroWinkler, fuzzyTitleSearch } from '../src/utils/jaroWinkler';

describe('jaro', () => {
    it('returns 1 for identical strings', () => {
        expect(jaro('hello', 'hello')).toBe(1);
    });

    it('returns 0 for empty', () => {
        expect(jaro('', 'abc')).toBe(0);
        expect(jaro('abc', '')).toBe(0);
    });

    it('canonical MARTHA / MARHTA test (0.944)', () => {
        // Winkler's textbook example
        expect(jaro('MARTHA', 'MARHTA')).toBeCloseTo(0.944, 2);
    });

    it('returns 0 for fully disjoint strings', () => {
        expect(jaro('abc', 'xyz')).toBe(0);
    });
});

describe('jaroWinkler', () => {
    it('rewards matching prefix over plain jaro', () => {
        const j = jaro('MARTHA', 'MARHTA');
        const jw = jaroWinkler('MARTHA', 'MARHTA');
        expect(jw).toBeGreaterThan(j);
    });

    it('MARTHA/MARHTA canonical jw ≈ 0.961', () => {
        expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.961, 2);
    });

    it('handles CJK prefix match', () => {
        // Both share first two BMP CJK characters
        const sc = jaroWinkler('小明筆記', '小明的觀察');
        expect(sc).toBeGreaterThan(0.6);
    });
});

describe('fuzzyTitleSearch', () => {
    const titles = new Map([
        ['a.md', 'Vault Search'],
        ['b.md', 'Vault Curate'],
        ['c.md', '小明的福音筆記'],
        ['d.md', '小明的觀察'],
        ['e.md', 'unrelated'],
    ]);

    it('matches close strings', () => {
        const r = fuzzyTitleSearch('Vault Searh', titles, 10);  // typo: missing c
        expect(r.has('a.md')).toBe(true);
    });

    it('matches CJK prefix', () => {
        const r = fuzzyTitleSearch('小明的', titles, 10, 0.6);
        expect(r.has('c.md')).toBe(true);
        expect(r.has('d.md')).toBe(true);
    });

    it('drops below minScore', () => {
        const r = fuzzyTitleSearch('xyz', titles, 10, 0.9);
        expect(r.size).toBe(0);
    });

    it('respects top N cap', () => {
        const r = fuzzyTitleSearch('Vault', titles, 1, 0.5);
        expect(r.size).toBe(1);
    });
});
