import { describe, it, expect } from 'vitest';
import {
    createKnnState,
    applyNoteUpserted,
    applyNoteRemoved,
    deriveGraph,
    needsRebuild,
    type KnnState,
} from '../src/search/knnIncremental';
import { buildKnnPicks } from '../src/search/semanticPath';

const K = 3;
const CAP = 0;

/** Unit vector on the 2D circle. */
function at(deg: number): Float32Array {
    const r = (deg * Math.PI) / 180;
    return new Float32Array([Math.cos(r), Math.sin(r)]);
}

/** Deterministic LCG so test 14 is reproducible. */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

function unitVec(dim: number, rnd: () => number): Float32Array {
    const v = new Float32Array(dim);
    let norm = 0;
    for (let i = 0; i < dim; i++) {
        v[i] = rnd() * 2 - 1;
        norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) v[i] /= norm;
    return v;
}

function stateFrom(notes: Array<{ path: string; vec: Float32Array }>, k = K, cap = CAP): KnnState {
    return createKnnState(notes, k, cap);
}

/** Full-rebuild picks over the state's current logical contents. */
function fullPicks(state: KnnState, k = K, cap = CAP) {
    const notes: Array<{ path: string; vec: Float32Array }> = [];
    for (let i = 0; i < state.n; i++) {
        notes.push({
            path: state.paths[i],
            vec: state.matrix.slice(i * state.dim, (i + 1) * state.dim),
        });
    }
    return buildKnnPicks(notes, k, cap);
}

const base = () => [
    { path: 'a.md', vec: at(0) },
    { path: 'b.md', vec: at(20) },
    { path: 'c.md', vec: at(45) },
    { path: 'd.md', vec: at(90) },
    { path: 'e.md', vec: at(180) },
];

describe('knnIncremental', () => {
    it('1. upsert of X recomputes picks[X] exactly as a full rebuild would', () => {
        const state = stateFrom(base());
        applyNoteUpserted(state, 'c.md', at(150), K, CAP);
        expect(state.picks.get('c.md')).toEqual(fullPicks(state).get('c.md'));
    });

    it('2. upsert of X updates the sim of every Y→X pick (weights stay exact)', () => {
        const state = stateFrom(base());
        const pickersOfC = [...state.revPicks.get('c.md')!];
        expect(pickersOfC.length).toBeGreaterThan(0);
        applyNoteUpserted(state, 'c.md', at(150), K, CAP);
        const full = fullPicks(state);
        for (const y of pickersOfC) {
            const edge = state.picks.get(y)!.find(e => e.path === 'c.md');
            if (!edge) continue; // y may have dropped c only via its own change — not here
            const exact = full.get(y)!.find(e => e.path === 'c.md');
            // Weight must equal the true dot even though membership is frozen.
            const iy = state.pathIndex.get(y)!;
            const ic = state.pathIndex.get('c.md')!;
            let dot = 0;
            for (let t = 0; t < state.dim; t++) {
                dot += state.matrix[iy * state.dim + t] * state.matrix[ic * state.dim + t];
            }
            expect(edge.sim).toBeCloseTo(dot, 10);
            if (exact) expect(edge.sim).toBeCloseTo(exact.sim, 10);
        }
    });

    it("3. upsert of X does NOT re-derive Y's membership (deliberate drift, pinned)", () => {
        const state = stateFrom(base());
        const before = new Map([...state.picks].map(([p, es]) => [p, es.map(e => e.path)]));
        applyNoteUpserted(state, 'c.md', at(150), K, CAP);
        for (const [p, targets] of before) {
            if (p === 'c.md') continue;
            expect(state.picks.get(p)!.map(e => e.path)).toEqual(targets);
        }
    });

    it('4. inserting a brand-new note grows the matrix and its picks exist', () => {
        const state = stateFrom(base());
        applyNoteUpserted(state, 'f.md', at(60), K, CAP);
        expect(state.n).toBe(6);
        expect(state.pathIndex.get('f.md')).toBeDefined();
        expect(state.picks.get('f.md')).toEqual(fullPicks(state).get('f.md'));
        expect(deriveGraph(state).has('f.md')).toBe(true);
    });

    it('5. remove deletes picks, purges X from every Y, and clears revPicks', () => {
        const state = stateFrom(base());
        applyNoteRemoved(state, 'c.md');
        expect(state.picks.has('c.md')).toBe(false);
        expect(state.revPicks.has('c.md')).toBe(false);
        for (const edges of state.picks.values()) {
            expect(edges.some(e => e.path === 'c.md')).toBe(false);
        }
        for (const pickers of state.revPicks.values()) {
            expect(pickers.has('c.md')).toBe(false);
        }
    });

    it('6. remove does not backfill: a picker of X ends with k-1 picks (pinned)', () => {
        const state = stateFrom(base());
        const y = [...state.revPicks.get('c.md')!][0];
        const before = state.picks.get(y)!.length;
        applyNoteRemoved(state, 'c.md');
        expect(state.picks.get(y)!.length).toBe(before - 1);
    });

    it('7. graph stays undirected-symmetric after changes', () => {
        const state = stateFrom(base());
        applyNoteUpserted(state, 'c.md', at(150), K, CAP);
        applyNoteRemoved(state, 'b.md');
        const graph = deriveGraph(state);
        for (const [from, edges] of graph) {
            for (const e of edges) {
                const back = graph.get(e.path)!.find(x => x.path === from);
                expect(back).toBeDefined();
                expect(back!.sim).toBe(e.sim);
            }
        }
    });

    it('8. a non-finite new vector removes the note from the graph (matches full-build filter)', () => {
        const state = stateFrom(base());
        applyNoteUpserted(state, 'c.md', new Float32Array([NaN, 1]), K, CAP);
        expect(state.picks.has('c.md')).toBe(false);
        expect(deriveGraph(state).has('c.md')).toBe(false);
        for (const edges of state.picks.values()) {
            expect(edges.some(e => e.path === 'c.md')).toBe(false);
        }
    });

    it('9. a dim-mismatched vector is rejected and flags needsFullRebuild', () => {
        const state = stateFrom(base());
        const before = state.n;
        applyNoteUpserted(state, 'c.md', new Float32Array([1, 0, 0]), K, CAP);
        expect(state.needsFullRebuild).toBe(true);
        expect(state.n).toBe(before);
    });

    it('10. changedSinceBuild counts distinct paths (editing twice counts once)', () => {
        const state = stateFrom(base());
        applyNoteUpserted(state, 'c.md', at(150), K, CAP);
        applyNoteUpserted(state, 'c.md', at(160), K, CAP);
        applyNoteRemoved(state, 'b.md');
        expect(state.changedSinceBuild.size).toBe(2);
    });

    it('11. needsRebuild boundary at the ratio; needsFullRebuild overrides the ratio', () => {
        const state = stateFrom(base()); // n = 5
        applyNoteUpserted(state, 'a.md', at(10), K, CAP); // 1/5 = 20%
        expect(needsRebuild(state, 0.4)).toBe(false);
        applyNoteUpserted(state, 'b.md', at(30), K, CAP); // 2/5 = 40%
        expect(needsRebuild(state, 0.4)).toBe(true);
        const fresh = stateFrom(base());
        fresh.needsFullRebuild = true;
        expect(needsRebuild(fresh, 0.4)).toBe(true);
    });

    it('12. sameFolderCap applies during incremental recompute', () => {
        const notes = [
            { path: 'dir/x.md', vec: at(0) },
            { path: 'dir/s1.md', vec: at(5) },
            { path: 'dir/s2.md', vec: at(10) },
            { path: 'other/y.md', vec: at(20) },
        ];
        const state = stateFrom(notes, 2, 1);
        applyNoteUpserted(state, 'dir/x.md', at(2), 2, 1);
        const targets = state.picks.get('dir/x.md')!.map(e => e.path);
        expect(targets).toHaveLength(2);
        expect(targets.filter(t => t.startsWith('dir/'))).toHaveLength(1);
        expect(targets).toContain('other/y.md');
    });

    it('13. empty state: every operation is a safe no-op / clean insert', () => {
        const state = stateFrom([]);
        expect(() => applyNoteRemoved(state, 'ghost.md')).not.toThrow();
        expect(needsRebuild(state, 0.1)).toBe(false);
        expect(deriveGraph(state).size).toBe(0);
        applyNoteUpserted(state, 'first.md', at(0), K, CAP);
        expect(state.n).toBe(1);
        expect(state.picks.get('first.md')).toEqual([]);
    });

    it('14. 500 synthetic notes, 20 random ops: a node re-picked LAST matches full rebuild exactly', () => {
        // The pinned invariant is "a node's picks are exact AS OF ITS OWN
        // last change" — later changes to OTHER notes may drift its
        // membership (that is the D6 approximation, healed by the drift
        // rebuild). So exact equality is asserted for nodes whose upsert
        // came after all other mutations.
        const rnd = lcg(42);
        const dim = 8;
        const notes = Array.from({ length: 500 }, (_, i) => ({
            path: `n${i}.md`,
            vec: unitVec(dim, rnd),
        }));
        const state = stateFrom(notes, 5, 0);
        for (let op = 0; op < 20; op++) {
            const i = Math.floor(rnd() * 500);
            const path = `n${i}.md`;
            if (rnd() < 0.3 && state.pathIndex.has(path)) {
                applyNoteRemoved(state, path);
            } else {
                applyNoteUpserted(state, path, unitVec(dim, rnd), 5, 0);
            }
        }
        // Final wave: three fresh upserts with nothing after them.
        const finalists = ['n7.md', 'n123.md', 'n480.md'];
        for (const path of finalists) {
            applyNoteUpserted(state, path, unitVec(dim, rnd), 5, 0);
        }
        const full = fullPicks(state, 5, 0);
        for (const path of finalists) {
            expect(state.picks.get(path)).toEqual(full.get(path));
        }
        // Structural sanity across the whole state: every pick target exists.
        for (const edges of state.picks.values()) {
            for (const e of edges) expect(state.pathIndex.has(e.path)).toBe(true);
        }
    });

    it('15. rename churn ×50 keeps the structure size stable (swap-remove, bounded capacity)', () => {
        const state = stateFrom(base());
        const capBefore = state.matrix.length;
        for (let i = 0; i < 50; i++) {
            applyNoteRemoved(state, 'c.md');
            applyNoteUpserted(state, 'c.md', at(45 + i), K, CAP);
        }
        expect(state.n).toBe(5);
        expect(state.paths.length).toBe(5);
        expect(state.pathIndex.size).toBe(5);
        expect(state.matrix.length).toBeLessThanOrEqual(capBefore * 4);
    });

    it('16. upsert is idempotent: same path + same vec twice ≡ once (queue-replay safety)', () => {
        const state = stateFrom(base());
        applyNoteUpserted(state, 'f.md', at(60), K, CAP);
        const nAfterFirst = state.n;
        const picksAfterFirst = new Map([...state.picks].map(([p, es]) => [p, es.map(e => ({ ...e }))]));
        applyNoteUpserted(state, 'f.md', at(60), K, CAP);
        expect(state.n).toBe(nAfterFirst);
        for (const [p, es] of picksAfterFirst) {
            expect(state.picks.get(p)).toEqual(es);
        }
    });
});
