// 014 D6/D7: incremental maintenance of the semantic k-NN graph.
//
// The ONE approximation in this change, with its boundary pinned here:
//   - the changed note's own picks are EXACT (full row re-scan, folder cap
//     included — same selection code path semantics as buildKnnPicks);
//   - edge WEIGHTS toward the changed note are EXACT (updated in place via
//     the reverse index);
//   - other nodes' pick MEMBERSHIP is frozen until they change themselves
//     or the drift-bounded full rebuild swaps a fresh state in (D6 #7).
// Deletions never backfill (a picker keeps k-1 picks); rename decomposes
// into remove + upsert at the indexer layer (Task 6).
//
// Matrix layout (D7): one contiguous Float32Array, capacity×dim, logical
// rows = n. Delete = swap-remove (last row fills the hole); insert grows
// by capacity doubling. Keeps rename churn from leaking rows.
//
// Pure module — zero Obsidian imports; state in, mutations applied, the
// caller (KnnGraphManager) owns threshold recomputation and persistence.

import { type KnnEdge, type KnnGraph, graphFromPicks } from './semanticPath';
import { folderOf } from '../utils/folderOf';

export interface KnnState {
    dim: number;
    /** index ↔ path for the logical rows [0, n). */
    paths: string[];
    pathIndex: Map<string, number>;
    folders: string[];
    /** capacity×dim backing store; rows ≥ n are garbage. */
    matrix: Float32Array;
    /** Logical row count. */
    n: number;
    /** Each node's own directed top-K (provenance layer, D5). */
    picks: Map<string, KnnEdge[]>;
    /** path → set of nodes whose picks contain it. */
    revPicks: Map<string, Set<string>>;
    /** Distinct paths changed since the last full build (drift counter). */
    changedSinceBuild: Set<string>;
    /** Set when the state is unconditionally untrustworthy (dim mismatch). */
    needsFullRebuild: boolean;
}

function isFiniteVec(v: Float32Array): boolean {
    for (let i = 0; i < v.length; i++) {
        if (!Number.isFinite(v[i])) return false;
    }
    return true;
}

function rebuildRevPicks(picks: Map<string, KnnEdge[]>): Map<string, Set<string>> {
    const rev = new Map<string, Set<string>>();
    for (const [from, edges] of picks) {
        for (const e of edges) {
            let s = rev.get(e.path);
            if (!s) rev.set(e.path, (s = new Set()));
            s.add(from);
        }
    }
    return rev;
}

/** Assemble a fresh state from note rows + their (already computed) picks,
 *  or compute picks here when omitted (test convenience / sync fallback). */
export function createKnnState(
    notes: Array<{ path: string; vec: Float32Array }>,
    k: number,
    sameFolderCap: number,
    precomputedPicks?: Map<string, KnnEdge[]>,
): KnnState {
    const valid = notes.filter((n) => isFiniteVec(n.vec));
    const dim = valid.length > 0 ? valid[0].vec.length : 0;
    const usable = valid.filter((n) => n.vec.length === dim);
    const n = usable.length;
    const matrix = new Float32Array(Math.max(1, n) * Math.max(1, dim));
    const paths: string[] = [];
    const folders: string[] = [];
    const pathIndex = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        matrix.set(usable[i].vec, i * dim);
        paths.push(usable[i].path);
        folders.push(folderOf(usable[i].path));
        pathIndex.set(usable[i].path, i);
    }
    let picks = precomputedPicks;
    if (!picks) {
        // Local selection over the packed rows — identical semantics to
        // buildKnnPicks (kept in sync by knnIncremental.test.ts #1/#14).
        picks = new Map();
        for (let i = 0; i < n; i++) picks.set(paths[i], []);
        if (k > 0 && n >= 2) {
            for (let i = 0; i < n; i++) {
                picks.set(paths[i], selectPicks(matrix, dim, n, i, paths, folders, k, sameFolderCap).picks);
            }
        }
    }
    return {
        dim,
        paths,
        pathIndex,
        folders,
        matrix,
        n,
        picks,
        revPicks: rebuildRevPicks(picks),
        changedSinceBuild: new Set(),
        needsFullRebuild: false,
    };
}

/** Top-K selection for row `i` over the packed matrix — mirrors
 *  buildKnnPicks' candidate order, sort and folder-cap semantics. Also
 *  returns the raw sims row so callers can update reverse edge weights
 *  without a second sweep. */
function selectPicks(
    matrix: Float32Array,
    dim: number,
    n: number,
    i: number,
    paths: string[],
    folders: string[],
    k: number,
    sameFolderCap: number,
): { picks: KnnEdge[]; simByRow: Float64Array } {
    // f64, not f32: these sims feed the reverse weight updates (D6 #2) and
    // MUST stay bit-identical to buildKnnPicks' f64 dot results — an f32
    // round-trip here diverges from a full rebuild at the 1e-8 level.
    const simByRow = new Float64Array(n);
    const sims: Array<{ j: number; sim: number }> = [];
    const iBase = i * dim;
    for (let j = 0; j < n; j++) {
        if (j === i) continue;
        let s = 0;
        const jBase = j * dim;
        for (let t = 0; t < dim; t++) s += matrix[iBase + t] * matrix[jBase + t];
        simByRow[j] = s;
        sims.push({ j, sim: s });
    }
    sims.sort((a, b) => b.sim - a.sim);
    const out: KnnEdge[] = [];
    let picked = 0;
    let sameFolder = 0;
    for (const { j, sim } of sims) {
        if (picked >= k) break;
        if (sameFolderCap > 0 && folders[j] === folders[i]) {
            if (sameFolder >= sameFolderCap) continue;
            sameFolder++;
        }
        picked++;
        out.push({ path: paths[j], sim });
    }
    return { picks: out, simByRow };
}

/** Detach `path`'s outgoing picks from the reverse index. */
function unlinkOutgoing(state: KnnState, path: string): void {
    const edges = state.picks.get(path);
    if (!edges) return;
    for (const e of edges) {
        state.revPicks.get(e.path)?.delete(path);
        if (state.revPicks.get(e.path)?.size === 0) state.revPicks.delete(e.path);
    }
}

/** Note created or its vector changed (D6 #1-3). */
export function applyNoteUpserted(
    state: KnnState,
    path: string,
    vec: Float32Array,
    k: number,
    sameFolderCap: number,
): void {
    state.changedSinceBuild.add(path);
    if (state.n > 0 && vec.length !== state.dim) {
        // Provider switch mid-state — the whole state is untrustworthy.
        state.needsFullRebuild = true;
        return;
    }
    if (!isFiniteVec(vec)) {
        // Full builds filter non-finite vectors out entirely — mirror that.
        removeInternal(state, path);
        return;
    }

    let idx = state.pathIndex.get(path);
    if (idx === undefined) {
        // New note: append, growing capacity by doubling when full.
        if (state.n === 0) state.dim = vec.length;
        const needed = (state.n + 1) * state.dim;
        if (needed > state.matrix.length) {
            const grown = new Float32Array(Math.max(needed, state.matrix.length * 2));
            grown.set(state.matrix);
            state.matrix = grown;
        }
        idx = state.n;
        state.n++;
        state.paths.push(path);
        state.folders.push(folderOf(path));
        state.pathIndex.set(path, idx);
    }
    state.matrix.set(vec, idx * state.dim);

    // Exact re-pick for this row; the sims row doubles as the weight
    // source for every Y that picked this note (D6 #2 — no second sweep).
    unlinkOutgoing(state, path);
    const { picks, simByRow } = selectPicks(
        state.matrix, state.dim, state.n, idx, state.paths, state.folders, k, sameFolderCap);
    state.picks.set(path, picks);
    for (const e of picks) {
        let s = state.revPicks.get(e.path);
        if (!s) state.revPicks.set(e.path, (s = new Set()));
        s.add(path);
    }

    const pickers = state.revPicks.get(path);
    if (pickers) {
        for (const y of pickers) {
            const yEdges = state.picks.get(y);
            if (!yEdges) continue;
            const yIdx = state.pathIndex.get(y);
            if (yIdx === undefined) continue;
            const edge = yEdges.find((e) => e.path === path);
            if (edge) edge.sim = simByRow[yIdx];
        }
    }
}

function removeInternal(state: KnnState, path: string): void {
    const idx = state.pathIndex.get(path);
    if (idx === undefined) return;

    // Drop provenance both ways: my picks, and my presence in others'.
    unlinkOutgoing(state, path);
    state.picks.delete(path);
    const pickers = state.revPicks.get(path);
    if (pickers) {
        for (const y of pickers) {
            const yEdges = state.picks.get(y);
            if (yEdges) state.picks.set(y, yEdges.filter((e) => e.path !== path)); // no backfill (D6 #4)
        }
        state.revPicks.delete(path);
    }

    // swap-remove the matrix row (D7).
    const last = state.n - 1;
    if (idx !== last) {
        state.matrix.copyWithin(idx * state.dim, last * state.dim, (last + 1) * state.dim);
        const movedPath = state.paths[last];
        state.paths[idx] = movedPath;
        state.folders[idx] = state.folders[last];
        state.pathIndex.set(movedPath, idx);
    }
    state.paths.pop();
    state.folders.pop();
    state.pathIndex.delete(path);
    state.n = last;
}

/** Note deleted (D6 #4); folder-level fan-out happens at the indexer layer. */
export function applyNoteRemoved(state: KnnState, path: string): void {
    if (!state.pathIndex.has(path)) return;
    state.changedSinceBuild.add(path);
    removeInternal(state, path);
}

/** The undirected graph queries run on — derived from the picks layer. */
export function deriveGraph(state: KnnState): KnnGraph {
    return graphFromPicks(state.picks);
}

/** Drift-bound check (D6 #7). `needsFullRebuild` overrides the ratio. */
export function needsRebuild(state: KnnState, ratio: number): boolean {
    if (state.needsFullRebuild) return true;
    if (state.n === 0) return false;
    return state.changedSinceBuild.size >= ratio * state.n;
}
