import { describe, it, expect } from 'vitest';
import { buildKnnPicks, graphFromPicks } from '../src/search/semanticPath';

/** Unit vectors on the 2D circle — cosine = cos(angle difference). */
function at(deg: number): Float32Array {
    const r = (deg * Math.PI) / 180;
    return new Float32Array([Math.cos(r), Math.sin(r)]);
}

describe('buildKnnPicks / graphFromPicks', () => {
    it('picks are directed: X picking Y does not imply Y picks X', () => {
        // c sits between a and b; with k=1, a picks c and b picks c,
        // but c (k=1) picks only its single nearest — b (10° away).
        const notes = [
            { path: 'a.md', vec: at(0) },
            { path: 'c.md', vec: at(40) },
            { path: 'b.md', vec: at(50) },
        ];
        const picks = buildKnnPicks(notes, 1, 0);
        expect(picks.get('a.md')!.map(e => e.path)).toEqual(['c.md']);
        expect(picks.get('c.md')!.map(e => e.path)).toEqual(['b.md']);
        // a picked c, but c did not pick a:
        expect(picks.get('c.md')!.some(e => e.path === 'a.md')).toBe(false);
    });

    it('graphFromPicks unions directions: one side picking creates the edge both ways with the same sim', () => {
        const notes = [
            { path: 'a.md', vec: at(0) },
            { path: 'c.md', vec: at(40) },
            { path: 'b.md', vec: at(50) },
        ];
        const graph = graphFromPicks(buildKnnPicks(notes, 1, 0));
        const aToC = graph.get('a.md')!.find(e => e.path === 'c.md');
        const cToA = graph.get('c.md')!.find(e => e.path === 'a.md');
        expect(aToC).toBeDefined();
        expect(cToA).toBeDefined();
        expect(aToC!.sim).toBe(cToA!.sim);
    });

    it('a pair picked by both sides yields exactly one undirected edge (no duplicates)', () => {
        const notes = [
            { path: 'a.md', vec: at(0) },
            { path: 'b.md', vec: at(10) },
            { path: 'far.md', vec: at(120) },
        ];
        // k=2: a and b definitely pick each other.
        const graph = graphFromPicks(buildKnnPicks(notes, 2, 0));
        expect(graph.get('a.md')!.filter(e => e.path === 'b.md')).toHaveLength(1);
        expect(graph.get('b.md')!.filter(e => e.path === 'a.md')).toHaveLength(1);
    });

    it('sameFolderCap applies at the picks layer (siblings skipped, next-ranked backfills)', () => {
        const notes = [
            { path: 'dir/x.md', vec: at(0) },
            { path: 'dir/s1.md', vec: at(5) },
            { path: 'dir/s2.md', vec: at(10) },
            { path: 'other/y.md', vec: at(20) },
        ];
        // k=2, cap=1: x may keep only one dir/ sibling; other/y backfills.
        const picks = buildKnnPicks(notes, 2, 1);
        const targets = picks.get('dir/x.md')!.map(e => e.path);
        expect(targets).toHaveLength(2);
        expect(targets).toContain('dir/s1.md');
        expect(targets).toContain('other/y.md');
        expect(targets).not.toContain('dir/s2.md');
    });

    it('notes with non-finite vector components are excluded before picking', () => {
        const notes = [
            { path: 'a.md', vec: at(0) },
            { path: 'bad.md', vec: new Float32Array([NaN, 1]) },
            { path: 'b.md', vec: at(20) },
        ];
        const picks = buildKnnPicks(notes, 2, 0);
        expect(picks.has('bad.md')).toBe(false);
        expect(picks.get('a.md')!.some(e => e.path === 'bad.md')).toBe(false);
    });

    it('candidates with a mismatched dimension are skipped', () => {
        const notes = [
            { path: 'a.md', vec: at(0) },
            { path: 'odd.md', vec: new Float32Array([1, 0, 0]) },
            { path: 'b.md', vec: at(20) },
        ];
        const picks = buildKnnPicks(notes, 2, 0);
        expect(picks.get('a.md')!.some(e => e.path === 'odd.md')).toBe(false);
    });
});
