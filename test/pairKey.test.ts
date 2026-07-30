import { describe, it, expect } from 'vitest';
import { pairKey, unpairKey } from '../src/utils/pairKey';

describe('pairKey', () => {
    it('is order-independent (a,b === b,a)', () => {
        expect(pairKey('a.md', 'b.md')).toBe(pairKey('b.md', 'a.md'));
    });

    it('is order-independent for CJK paths', () => {
        expect(pairKey('資料/甲.md', '資料/乙.md')).toBe(pairKey('資料/乙.md', '資料/甲.md'));
    });

    it('same path twice yields "a\\na" (callers never self-pair)', () => {
        expect(pairKey('a.md', 'a.md')).toBe('a.md\na.md');
    });

    it('unpairKey(pairKey(a,b)) round-trips in sorted order', () => {
        expect(unpairKey(pairKey('z.md', 'a.md'))).toEqual(['a.md', 'z.md']);
    });

    it('round-trips paths containing spaces, # and |', () => {
        const a = 'notes/a #tag | pipe.md';
        const b = 'notes/b file.md';
        expect(unpairKey(pairKey(a, b))).toEqual([a, b].sort());
    });

    it('unpairKey without a separator returns [key, ""] and never throws', () => {
        expect(unpairKey('nolinebreak')).toEqual(['nolinebreak', '']);
    });
});
