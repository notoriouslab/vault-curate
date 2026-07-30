// 014 D4: flat-array codec for the worker boundary. The matrix and the
// picks cross the boundary as Transferable buffers — no structured-clone
// serialisation of the vector payload (the optimisation SC never
// shipped); strings (paths) go structured clone — they are small
// next to the vectors. NB: the resident incremental state still makes ONE
// copy of the rows into its own backing matrix (createKnnState), by
// design — the transfer saves the clone at the boundary, not every copy.
//
// pickSims is Float64Array, NOT Float32Array (apply-time deviation from
// the original design table, recorded in design.md's apply review
// section): pick sims are f64 dot products, and an f32 round-trip would
// make worker-built graphs diverge from the sync fallback at the 1e-8
// level — breaking the "results identical" acceptance (驗收 2). Same
// lesson as knnIncremental's simByRow.

import { type KnnEdge } from './semanticPath';

export interface PackedNotes {
    /** N×dim contiguous rows, row i = paths[i]. */
    matrix: Float32Array;
    paths: string[];
}

/** The dominant vector dimension across rows (四路總檢 紅隊 W3). The
 *  previous `rows[0].length` heuristic rode on SQL row order — one stale
 *  row from an interrupted provider switch, sorted first, silently threw
 *  away every healthy note. Majority vote is order-independent. */
export function majorityDim(rows: Array<{ noteVec: Float32Array }>): number {
    const counts = new Map<number, number>();
    for (const r of rows) {
        counts.set(r.noteVec.length, (counts.get(r.noteVec.length) ?? 0) + 1);
    }
    let best = 0;
    let bestCount = -1;
    for (const [dim, count] of counts) {
        if (count > bestCount) { best = dim; bestCount = count; }
    }
    return best;
}

export interface PackedPicks {
    /** Picks per node, in paths order. */
    pickCounts: Int32Array;
    /** Flattened pick target indices (into paths). */
    pickTargets: Int32Array;
    /** Flattened pick sims — f64 to stay bit-identical to the sync path. */
    pickSims: Float64Array;
}

function isFiniteVec(v: Float32Array): boolean {
    for (let i = 0; i < v.length; i++) {
        if (!Number.isFinite(v[i])) return false;
    }
    return true;
}

/** Pack store rows into one contiguous matrix. Skips rows whose vector
 *  does not match `dim` (provider-switch mid-state, same policy as the
 *  dimGuard in discoverSqlite) AND non-finite rows — filtering here keeps
 *  `picks.size === paths.length` downstream, so the packed round-trip
 *  aligns 1:1 with the direct build. */
export function packNotes(
    rows: Array<{ path: string; noteVec: Float32Array }>,
    dim: number,
): PackedNotes {
    const usable = rows.filter((r) => r.noteVec.length === dim && isFiniteVec(r.noteVec));
    if (usable.length < rows.length) {
        // Same diagnosability contract as discoverSqlite's dimGuard: never
        // shrink the working set silently (四路總檢 紅隊 W3).
        console.warn(`vault-curate: knn packNotes skipped ${rows.length - usable.length} of ${rows.length} notes (dim≠${dim} or non-finite). Provider switched mid-index? Re-index to recover.`);
    }
    const matrix = new Float32Array(usable.length * dim);
    const paths: string[] = [];
    for (let i = 0; i < usable.length; i++) {
        matrix.set(usable[i].noteVec, i * dim);
        paths.push(usable[i].path);
    }
    return { matrix, paths };
}

export function packPicks(
    picks: Map<string, KnnEdge[]>,
    paths: string[],
    pathIndex: Map<string, number>,
): PackedPicks {
    let total = 0;
    for (const edges of picks.values()) total += edges.length;
    const pickCounts = new Int32Array(paths.length);
    const pickTargets = new Int32Array(total);
    const pickSims = new Float64Array(total);
    let cursor = 0;
    // Iterate the canonical paths order (not picks insertion order) so the
    // encoding stays aligned even if a caller hands in a sparse picks map.
    for (let i = 0; i < paths.length; i++) {
        const edges = picks.get(paths[i]) ?? [];
        pickCounts[i] = edges.length;
        for (const e of edges) {
            pickTargets[cursor] = pathIndex.get(e.path)!;
            pickSims[cursor] = e.sim;
            cursor++;
        }
    }
    return { pickCounts, pickTargets, pickSims };
}

/** Rebuild the picks Map in paths order — the same insertion order the
 *  direct build produces, keeping downstream adjacency order (and thus
 *  path tie-breaking inputs) identical. */
export function unpackPicks(
    pickCounts: Int32Array,
    pickTargets: Int32Array,
    pickSims: Float64Array,
    paths: string[],
): Map<string, KnnEdge[]> {
    const picks = new Map<string, KnnEdge[]>();
    let cursor = 0;
    for (let i = 0; i < paths.length; i++) {
        const count = pickCounts[i];
        const edges: KnnEdge[] = [];
        for (let c = 0; c < count; c++) {
            edges.push({ path: paths[pickTargets[cursor]], sim: pickSims[cursor] });
            cursor++;
        }
        picks.set(paths[i], edges);
    }
    return picks;
}
