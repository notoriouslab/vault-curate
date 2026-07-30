import { describe, it, expect } from 'vitest';
import { packNotes, packPicks, unpackPicks, majorityDim } from '../src/search/knnCodec';
import { buildKnnPicks } from '../src/search/semanticPath';

function at(deg: number): Float32Array {
    const r = (deg * Math.PI) / 180;
    return new Float32Array([Math.cos(r), Math.sin(r)]);
}

describe('knnCodec', () => {
    it('picks round-trip is identity (order, targets and f64 sims preserved)', () => {
        const notes = [
            { path: 'a.md', vec: at(0) },
            { path: 'b.md', vec: at(20) },
            { path: 'c.md', vec: at(45) },
            { path: 'd.md', vec: at(90) },
        ];
        const picks = buildKnnPicks(notes, 2, 0);
        const paths = notes.map(n => n.path);
        const pathIndex = new Map(paths.map((p, i) => [p, i]));
        const packed = packPicks(picks, paths, pathIndex);
        const back = unpackPicks(packed.pickCounts, packed.pickTargets, packed.pickSims, paths);
        expect([...back.keys()]).toEqual([...picks.keys()]);
        for (const [p, edges] of picks) {
            expect(back.get(p)).toEqual(edges); // toEqual on f64 sims = exact
        }
    });

    it('empty picks round-trip stays empty per node', () => {
        const picks = new Map([['a.md', []], ['b.md', []]]);
        const paths = ['a.md', 'b.md'];
        const pathIndex = new Map(paths.map((p, i) => [p, i]));
        const packed = packPicks(picks, paths, pathIndex);
        const back = unpackPicks(packed.pickCounts, packed.pickTargets, packed.pickSims, paths);
        expect(back.get('a.md')).toEqual([]);
        expect(back.get('b.md')).toEqual([]);
    });

    it('packNotes lays rows contiguously, skipping dim-mismatched and non-finite rows', () => {
        const rows = [
            { path: 'a.md', noteVec: at(0) },
            { path: 'odd.md', noteVec: new Float32Array([1, 0, 0]) },
            { path: 'bad.md', noteVec: new Float32Array([NaN, 1]) },
            { path: 'dir/b.md', noteVec: at(90) },
        ];
        const packed = packNotes(rows, 2);
        expect(packed.paths).toEqual(['a.md', 'dir/b.md']);
        expect([...packed.matrix.slice(0, 2)]).toEqual([...at(0)]);
        expect([...packed.matrix.slice(2, 4)]).toEqual([...at(90)]);
        expect(packed.matrix.length).toBe(4);
    });

    it('majorityDim ignores a stale first row (order-independent, 紅隊 W3)', () => {
        const rows = [
            { noteVec: new Float32Array(4) },   // stale old-model row sorted first
            { noteVec: new Float32Array(512) },
            { noteVec: new Float32Array(512) },
            { noteVec: new Float32Array(512) },
        ];
        expect(majorityDim(rows)).toBe(512);
        expect(majorityDim([])).toBe(0);
    });

    it('CJK paths survive the round-trip', () => {
        const notes = [
            { path: '資料/甲.md', vec: at(0) },
            { path: '資料/乙.md', vec: at(30) },
        ];
        const picks = buildKnnPicks(notes, 1, 0);
        const paths = notes.map(n => n.path);
        const pathIndex = new Map(paths.map((p, i) => [p, i]));
        const packed = packPicks(picks, paths, pathIndex);
        const back = unpackPicks(packed.pickCounts, packed.pickTargets, packed.pickSims, paths);
        expect(back.get('資料/甲.md')![0].path).toBe('資料/乙.md');
    });
});
