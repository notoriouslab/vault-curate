import { describe, it, expect } from 'vitest';
import { formatScore } from '../src/utils/formatScore';

describe('formatScore', () => {
    it('formats a finite score to two decimals', () => {
        expect(formatScore(0.456)).toBe('0.46');
    });

    it('renders NaN as a dash instead of "NaN"', () => {
        expect(formatScore(NaN)).toBe('–');
    });

    it('renders Infinity as a dash', () => {
        expect(formatScore(Infinity)).toBe('–');
    });

    it('renders -Infinity as a dash', () => {
        expect(formatScore(-Infinity)).toBe('–');
    });
});
