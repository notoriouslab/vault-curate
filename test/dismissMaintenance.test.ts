import { describe, it, expect } from 'vitest';
import { renameInDismissed, deleteFromDismissed } from '../src/utils/dismissMaintenance';
import { pairKey } from '../src/utils/pairKey';

describe('renameInDismissed', () => {
    it('rewrites a key whose pair order flips after rename (z.md → a.md)', () => {
        const pairs = { [pairKey('z.md', 'm.md')]: 100 };
        const out = renameInDismissed(pairs, {}, 'z.md', 'a.md');
        expect(out.pairs).toEqual({ [pairKey('a.md', 'm.md')]: 100 });
    });

    it('touches only entries containing oldPath', () => {
        const pairs = {
            [pairKey('a.md', 'b.md')]: 1,
            [pairKey('c.md', 'd.md')]: 2,
        };
        const out = renameInDismissed(pairs, {}, 'a.md', 'x.md');
        expect(out.pairs).toEqual({
            [pairKey('x.md', 'b.md')]: 1,
            [pairKey('c.md', 'd.md')]: 2,
        });
    });

    it('keeps the original dismissedAt timestamp', () => {
        const out = renameInDismissed({ [pairKey('a.md', 'b.md')]: 12345 }, {}, 'a.md', 'c.md');
        expect(out.pairs[pairKey('c.md', 'b.md')]).toBe(12345);
    });

    it('on key collision keeps the earlier dismissedAt', () => {
        const pairs = {
            [pairKey('a.md', 'b.md')]: 200,
            [pairKey('c.md', 'b.md')]: 100,
        };
        // a.md → c.md makes the first key collide with the second
        const out = renameInDismissed(pairs, {}, 'a.md', 'c.md');
        expect(out.pairs).toEqual({ [pairKey('c.md', 'b.md')]: 100 });
    });

    it('rename of an unknown path leaves both records unchanged', () => {
        const pairs = { [pairKey('a.md', 'b.md')]: 1 };
        const notes = { 'n.md': 2 };
        const out = renameInDismissed(pairs, notes, 'ghost.md', 'x.md');
        expect(out.pairs).toEqual(pairs);
        expect(out.notes).toEqual(notes);
    });

    it('empty records never throw and stay empty', () => {
        const out = renameInDismissed({}, {}, 'a.md', 'b.md');
        expect(out.pairs).toEqual({});
        expect(out.notes).toEqual({});
    });

    it('folder rename rewrites both sides of pair keys and note keys (筆記 → 筆記2)', () => {
        const pairs = { [pairKey('筆記/A.md', '筆記/B.md')]: 7 };
        const notes = { '筆記/C.md': 8 };
        const out = renameInDismissed(pairs, notes, '筆記', '筆記2');
        expect(out.pairs).toEqual({ [pairKey('筆記2/A.md', '筆記2/B.md')]: 7 });
        expect(out.notes).toEqual({ '筆記2/C.md': 8 });
    });

    it('folder rename must not touch a sibling folder sharing the prefix (筆記 vs 筆記本)', () => {
        const pairs = { [pairKey('筆記本/C.md', 'x.md')]: 9 };
        const notes = { '筆記本/D.md': 10 };
        const out = renameInDismissed(pairs, notes, '筆記', '筆記2');
        expect(out.pairs).toEqual(pairs);
        expect(out.notes).toEqual(notes);
    });

    it('folder rename with simultaneous re-sort and collision keeps the earlier timestamp', () => {
        const pairs = {
            [pairKey('z/A.md', 'm.md')]: 300,
            [pairKey('a/A.md', 'm.md')]: 100,
        };
        // z → a collides the first key into the second after re-sort
        const out = renameInDismissed(pairs, {}, 'z', 'a');
        expect(out.pairs).toEqual({ [pairKey('a/A.md', 'm.md')]: 100 });
    });
});

describe('deleteFromDismissed', () => {
    it('removes pair entries where either side matches', () => {
        const pairs = {
            [pairKey('a.md', 'b.md')]: 1,
            [pairKey('b.md', 'c.md')]: 2,
            [pairKey('c.md', 'd.md')]: 3,
        };
        const out = deleteFromDismissed(pairs, {}, 'b.md');
        expect(out.pairs).toEqual({ [pairKey('c.md', 'd.md')]: 3 });
    });

    it('removes the note entry for the deleted path', () => {
        const out = deleteFromDismissed({}, { 'a.md': 1, 'b.md': 2 }, 'a.md');
        expect(out.notes).toEqual({ 'b.md': 2 });
    });

    it('folder delete removes every entry under the folder, sparing prefix siblings', () => {
        const pairs = {
            [pairKey('dir/A.md', 'x.md')]: 1,
            [pairKey('dir2/B.md', 'x.md')]: 2,
        };
        const notes = { 'dir/C.md': 3, 'dir2/D.md': 4 };
        const out = deleteFromDismissed(pairs, notes, 'dir');
        expect(out.pairs).toEqual({ [pairKey('dir2/B.md', 'x.md')]: 2 });
        expect(out.notes).toEqual({ 'dir2/D.md': 4 });
    });
});
