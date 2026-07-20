/**
 * semanticPath — bottleneck ("widest") path over the vault's semantic
 * k-NN graph (009 D1/D2).
 *
 * The chain from note A to note E is judged by its WEAKEST link: we
 * maximize the minimum edge similarity along the path ("every hop must
 * hold"), which also makes the search naturally hub-resistant. Hop count
 * breaks bottleneck ties; a deterministic path-key comparison breaks the
 * rest, so identical inputs always produce identical output (pinned by
 * tests).
 *
 * Pure module — zero Obsidian imports.
 */

import { folderOf } from '../utils/folderOf';

/** Starting K (design D1); G4 dogfood re-tunes over {5,10,15}. */
export const DEFAULT_KNN_K = 10;
/** Hop cap (design D2). */
export const DEFAULT_MAX_HOPS = 6;
/** Per-node same-folder edge cap (D1 amendment, 2026-07-20): template
 *  siblings crowd out cross-folder edges and force garbage bridges —
 *  same value and skip-and-backfill semantics as 008's Find Similar cap.
 *  Offline evidence: evidence/option-study.md (cap sweep). */
export const KNN_SAME_FOLDER_CAP = 3;
/** Verdict threshold percentile (D4 amendment, 2026-07-20): a chain whose
 *  bottleneck sits below this percentile of the graph's own edge-similarity
 *  distribution is reported as "not connected". Percentile anchoring keeps
 *  the rule scale-free across embedding models. Calibrated on 4 real cases
 *  + 229 proxy positives + 300 random pairs (evidence/option-study.md). */
export const BOTTLENECK_PERCENTILE = 45;

export type KnnEdge = { path: string; sim: number };
/** Adjacency list; symmetric (undirected union of both nodes' top-K). */
export type KnnGraph = Map<string, KnnEdge[]>;

export interface SemanticPath {
    /** Note paths from `from` to `to`, inclusive. */
    path: string[];
    /** The minimum edge similarity along the path. */
    bottleneck: number;
    /** Edge similarities in order; length = path.length - 1. */
    sims: number[];
}

function dot(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

/** Corrupted embeddings (NaN/Infinity components) must not enter the
 *  graph: a single NaN edge poisons the DP (`x > NaN` and `x === NaN`
 *  are both false, silently discarding valid paths) and turns the
 *  percentile threshold into NaN, disabling the weak-chain verdict
 *  (red-team 2026-07-20; same class as 007's composeNoteVec guard). */
function isFiniteVec(v: Float32Array): boolean {
    for (let i = 0; i < v.length; i++) {
        if (!Number.isFinite(v[i])) return false;
    }
    return true;
}

/**
 * Build the undirected k-NN graph: each node contributes edges to its
 * top-`k` most similar neighbours; the edge set is the union of both
 * directions (an edge exists if EITHER endpoint ranked the other in its
 * top-K). Vectors are assumed unit-norm (noteVec contract, 007 D4) so
 * dot product is cosine similarity.
 *
 * `sameFolderCap` (> 0) limits how many of a node's k picks may share its
 * folder — skip-and-backfill, same semantics as 008's Find Similar cap:
 * capped siblings are skipped and the next-ranked cross-folder candidates
 * fill the freed slots. Without it, template siblings monopolize the
 * top-K and cross-cluster paths get forced through garbage bridges.
 *
 * O(N²) similarity sweep — built on demand per invocation (009 D1-A);
 * ~2-5s at 2.5k notes, callers show a Notice.
 */
export function buildKnnGraph(
    notes: Array<{ path: string; vec: Float32Array }>,
    k: number,
    sameFolderCap = 0,
): KnnGraph {
    notes = notes.filter((n) => isFiniteVec(n.vec));
    const graph: KnnGraph = new Map();
    for (const n of notes) graph.set(n.path, []);
    if (k <= 0 || notes.length < 2) return graph;

    const edgeKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
    const added = new Set<string>();
    const folders = notes.map((n) => folderOf(n.path));

    for (let i = 0; i < notes.length; i++) {
        const sims: Array<{ j: number; sim: number }> = [];
        for (let j = 0; j < notes.length; j++) {
            if (j === i) continue;
            if (notes[j].vec.length !== notes[i].vec.length) continue;
            sims.push({ j, sim: dot(notes[i].vec, notes[j].vec) });
        }
        sims.sort((a, b) => b.sim - a.sim);
        let picked = 0;
        let sameFolder = 0;
        for (const { j, sim } of sims) {
            if (picked >= k) break;
            if (sameFolderCap > 0 && folders[j] === folders[i]) {
                if (sameFolder >= sameFolderCap) continue;
                sameFolder++;
            }
            picked++;
            const key = edgeKey(notes[i].path, notes[j].path);
            if (added.has(key)) continue;
            added.add(key);
            graph.get(notes[i].path)!.push({ path: notes[j].path, sim });
            graph.get(notes[j].path)!.push({ path: notes[i].path, sim });
        }
    }
    return graph;
}

/**
 * The `p`-th percentile (0-100) of the graph's unique edge similarities,
 * with linear interpolation (numpy-equivalent, pinning the offline
 * calibration). Returns 0 for an edgeless graph — no path exists there
 * anyway, so the verdict threshold never fires.
 */
export function edgeSimPercentile(graph: KnnGraph, p: number): number {
    const sims: number[] = [];
    const seen = new Set<string>();
    for (const [from, edges] of graph) {
        for (const e of edges) {
            if (!Number.isFinite(e.sim)) continue; // NaN would poison the interpolation
            const key = from < e.path ? `${from}\n${e.path}` : `${e.path}\n${from}`;
            if (seen.has(key)) continue;
            seen.add(key);
            sims.push(e.sim);
        }
    }
    if (sims.length === 0) return 0;
    sims.sort((a, b) => a - b);
    const rank = (Math.min(100, Math.max(0, p)) / 100) * (sims.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return sims[lo] + (sims[hi] - sims[lo]) * (rank - lo);
}

/** Reconstruct the path ending at `v` with `h` hops from the parent table. */
function reconstruct(
    parent: Array<Map<string, string>>,
    from: string,
    v: string,
    h: number,
): string[] {
    const out: string[] = [v];
    let cur = v;
    for (let step = h; step > 0; step--) {
        const p = parent[step].get(cur);
        if (p === undefined) return []; // defensive: broken chain
        out.push(p);
        cur = p;
    }
    if (cur !== from) return [];
    return out.reverse();
}

/** Deterministic tie key (design D2): join("\n") then plain JS `<`. */
function pathKey(path: string[]): string {
    return path.join('\n');
}

/**
 * Hop-capped widest (bottleneck) path.
 *
 * DP (design D2-A):
 *   dp[0][from] = +Infinity, dp[0][v≠from] = -Infinity
 *   dp[h][v] = max over neighbours u of min(dp[h-1][u], sim(u,v))
 * Answer: over h = 1..maxHops, maximize bottleneck; tie → fewest hops;
 * tie → smallest path key. Returns null when from === to (caller shows
 * the A=E notice), when either endpoint is missing, or when no path
 * exists within maxHops.
 */
export function widestPath(
    graph: KnnGraph,
    from: string,
    to: string,
    maxHops = 6,
): SemanticPath | null {
    if (from === to) return null;
    if (!graph.has(from) || !graph.has(to)) return null;

    let prev = new Map<string, number>();
    prev.set(from, Infinity);
    const parent: Array<Map<string, string>> = [new Map()];

    let best: { bottleneck: number; hops: number; path: string[] } | null = null;

    for (let h = 1; h <= maxHops; h++) {
        const cur = new Map<string, number>();
        const curParent = new Map<string, string>();
        parent.push(curParent);

        for (const [u, du] of prev) {
            if (du === -Infinity) continue;
            for (const { path: v, sim } of graph.get(u) ?? []) {
                const cand = Math.min(du, sim);
                if (Number.isNaN(cand)) continue; // hand-built graphs may carry NaN edges
                const existing = cur.get(v);
                if (existing === undefined || cand > existing) {
                    cur.set(v, cand);
                    curParent.set(v, u);
                } else if (cand === existing) {
                    // Deterministic tie: compare full prefix path keys.
                    const viaU = pathKey([...reconstruct(parent, from, u, h - 1), v]);
                    const viaOld = pathKey(reconstruct(parent, from, v, h));
                    if (viaU < viaOld) curParent.set(v, u);
                }
            }
        }

        const dTo = cur.get(to);
        if (dTo !== undefined && dTo > -Infinity) {
            const path = reconstruct(parent, from, to, h);
            if (path.length > 0) {
                const better =
                    best === null ||
                    dTo > best.bottleneck ||
                    (dTo === best.bottleneck && h < best.hops) ||
                    (dTo === best.bottleneck && h === best.hops && pathKey(path) < pathKey(best.path));
                if (better) best = { bottleneck: dTo, hops: h, path };
            }
        }
        prev = cur;
        // The parent table depends on hop layers, so we keep iterating even
        // after a hit — a longer path can still carry a higher bottleneck.
    }

    if (!best) return null;
    const sims: number[] = [];
    for (let i = 1; i < best.path.length; i++) {
        const e = (graph.get(best.path[i - 1]) ?? []).find(x => x.path === best.path[i]);
        sims.push(e ? e.sim : NaN);
    }
    return { path: best.path, bottleneck: best.bottleneck, sims };
}
