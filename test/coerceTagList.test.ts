import { describe, it, expect } from 'vitest';
import { coerceTagList } from '../src/utils/coerceTagList';

describe('coerceTagList', () => {
    it('passes an array through unchanged', () => {
        expect(coerceTagList(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('splits a whitespace-separated string (Qwen3.5-4B shape)', () => {
        expect(coerceTagList('向量檢索 語意搜尋 本地模型')).toEqual(['向量檢索', '語意搜尋', '本地模型']);
    });

    it('splits on commas and CJK separators', () => {
        expect(coerceTagList('a,b、c，d')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('drops empty segments from repeated separators', () => {
        expect(coerceTagList('a  ,, b')).toEqual(['a', 'b']);
    });

    it('returns empty list for an empty or whitespace-only string', () => {
        expect(coerceTagList('')).toEqual([]);
        expect(coerceTagList('   ')).toEqual([]);
    });

    it('returns empty list for non-array non-string shapes', () => {
        expect(coerceTagList(42)).toEqual([]);
        expect(coerceTagList({ a: 1 })).toEqual([]);
        expect(coerceTagList(null)).toEqual([]);
        expect(coerceTagList(undefined)).toEqual([]);
    });

    it('does not cap the number of tags (consistent with the array path)', () => {
        expect(coerceTagList('a b c d e f g')).toHaveLength(7);
    });
});
