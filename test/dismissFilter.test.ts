import { describe, it, expect } from 'vitest';
import { filterDismissedPairs, filterDismissedNotes } from '../src/search/dismissFilter';
import { pairKey } from '../src/utils/pairKey';

const row = (path: string) => ({ path, score: 0.9 });

describe('filterDismissedPairs', () => {
    it('drops a dismissed pair', () => {
        const dismissed = { [pairKey('anchor.md', 'b.md')]: 1 };
        const out = filterDismissedPairs([row('a.md'), row('b.md')], 'anchor.md', dismissed);
        expect(out.map(r => r.path)).toEqual(['a.md']);
    });

    it('refills the slot: 12 candidates, top 10, first one dismissed → still 10 results', () => {
        const candidates = Array.from({ length: 12 }, (_, i) => row(`n${i}.md`));
        const dismissed = { [pairKey('anchor.md', 'n0.md')]: 1 };
        const out = filterDismissedPairs(candidates, 'anchor.md', dismissed).slice(0, 10);
        expect(out).toHaveLength(10);
        expect(out.map(r => r.path)).not.toContain('n0.md');
        expect(out.map(r => r.path)).toContain('n10.md'); // the backfilled slot
    });

    it('matches regardless of key direction (B↔A)', () => {
        const dismissed = { [pairKey('b.md', 'anchor.md')]: 1 };
        const out = filterDismissedPairs([row('b.md')], 'anchor.md', dismissed);
        expect(out).toEqual([]);
    });

    it('returns results untouched when dismissed is empty or undefined', () => {
        const results = [row('a.md'), row('b.md')];
        expect(filterDismissedPairs(results, 'anchor.md', {})).toEqual(results);
        expect(filterDismissedPairs(results, 'anchor.md', undefined)).toEqual(results);
    });

    it('ignores dismissed entries whose paths are stale (D7 lazy fallback)', () => {
        const dismissed = { [pairKey('anchor.md', 'gone.md')]: 1 };
        const results = [row('a.md'), row('b.md')];
        expect(filterDismissedPairs(results, 'anchor.md', dismissed)).toEqual(results);
    });

    it('returns [] without throwing when every candidate is dismissed', () => {
        const dismissed = {
            [pairKey('anchor.md', 'a.md')]: 1,
            [pairKey('anchor.md', 'b.md')]: 2,
        };
        expect(filterDismissedPairs([row('a.md'), row('b.md')], 'anchor.md', dismissed)).toEqual([]);
    });

    it('filters a graph neighbor list with the center note as anchor (驗收 2b unit layer)', () => {
        const neighbors = [row('n1.md'), row('n2.md'), row('n3.md')];
        const dismissed = { [pairKey('center.md', 'n2.md')]: 1 };
        const out = filterDismissedPairs(neighbors, 'center.md', dismissed);
        expect(out.map(r => r.path)).toEqual(['n1.md', 'n3.md']);
    });
});

describe('filterDismissedNotes', () => {
    it('drops a dismissed note from global results', () => {
        const dismissed = { 'cold.md': 1 };
        const out = filterDismissedNotes([row('cold.md'), row('keep.md')], dismissed);
        expect(out.map(r => r.path)).toEqual(['keep.md']);
    });
});
