// Global Discover profile + grouped ranking (012) — pure functions, no
// Obsidian imports.
//
// "Related to your current thinking" used to mean "max cosine against any
// single Hot note", which is register dominance at vault scale: one Hot
// family chat pulls up every Cold family chat. The profile replaces it
// with intent-grade signals: the notes the user recently JUDGED (edited or
// created — plugin batch writes exempted), their curated topic tags
// (structural tags df-filtered out), and their vector centroid. Ranking is
// grouped per top-level folder because register bands occupy disjoint
// similarity ranges (dialogues 0.88-0.92 vs note gems 0.80-0.86 in the
// pilot) — a single global cutoff would bury every non-dialogue gem.
// Design + pilot evidence: openspec/changes/012-global-discover-profile/.

import type { SearchResult } from "../types";
import { fuseRanks } from "./relatedFusion";

/** Profile size: how many recent judgment-action notes represent the
 *  user's current thinking. */
export const PROFILE_K = 20;
/** Tags carried by more than this fraction of the vault are structural
 *  (platform/folder markers), not topical. */
export const TAG_DF_MAX = 0.05;
/** Per-group fusion pool: top-N of the group's semantic order. */
export const GROUP_POOL = 20;
/** Results shown per group. */
export const GROUP_TAKE = 3;

export interface ProfileCandidate {
    path: string;
    /** max(created, mtime) — judgment-action recency (design D1; created
     *  resolved by the caller with the same semantics as heat). */
    judgedAt: number;
    /** Parsed tags (parseTags), possibly with duplicates within a note. */
    tags: string[];
    /** True when the note's mtime matches the self-write ledger — a
     *  plugin batch write, not a user judgment. */
    exempt: boolean;
}

/**
 * Build the thinking profile (D1): non-exempt candidates by judgedAt
 * descending (tie → path lexical, deterministic), keeping the first K
 * that carry at least one topical tag. Returned `tags` is a MULTISET
 * across notes (repeats = BM25 query-tf weight; within one note tags are
 * deduped first). Degradation (D1 chain): when no candidate has a topical
 * tag, the centroid falls back to the plain recent K and the lexical side
 * stays empty.
 */
export function buildProfile(
    candidates: ProfileCandidate[],
    dfMap: Map<string, number>,
    totalNotes: number,
    k: number = PROFILE_K,
): { paths: string[]; tags: string[] } {
    // Multiplication form: df ≤ 5% of total without dividing (totalNotes 0
    // ⇒ only df-0 tags pass, which cannot occur for a tag that exists).
    const topical = (t: string) => (dfMap.get(t) ?? 0) <= TAG_DF_MAX * totalNotes;
    const sorted = candidates
        .filter((c) => !c.exempt)
        .sort((a, b) => (b.judgedAt - a.judgedAt) || (a.path < b.path ? -1 : 1));

    const paths: string[] = [];
    const tags: string[] = [];
    for (const c of sorted) {
        const topicalTags = [...new Set(c.tags)].filter(topical);
        if (topicalTags.length === 0) continue;
        paths.push(c.path);
        tags.push(...topicalTags);
        if (paths.length === k) break;
    }
    if (paths.length === 0) {
        return { paths: sorted.slice(0, k).map((c) => c.path), tags: [] };
    }
    return { paths, tags };
}

/** Unit-norm centroid of the profile vectors. Vectors with a non-finite
 *  component or a mismatched dimension are skipped; all-bad (or zero-norm)
 *  returns null and the caller short-circuits to the empty state (D7). */
export function profileCentroid(vecs: Float32Array[]): Float32Array | null {
    let dim = 0;
    for (const v of vecs) if (v.length > 0) { dim = v.length; break; }
    if (dim === 0) return null;

    const sum = new Float32Array(dim);
    let used = 0;
    for (const v of vecs) {
        if (v.length !== dim) continue;
        let finite = true;
        for (let i = 0; i < dim; i++) {
            if (!Number.isFinite(v[i])) { finite = false; break; }
        }
        if (!finite) continue;
        for (let i = 0; i < dim; i++) sum[i] += v[i];
        used++;
    }
    if (used === 0) return null;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += sum[i] * sum[i];
    norm = Math.sqrt(norm);
    if (!(norm > 0)) return null;
    for (let i = 0; i < dim; i++) sum[i] /= norm;
    return sum;
}

export interface GroupedResults {
    /** Top-level folder ("/" for vault-root notes). */
    group: string;
    results: SearchResult[];
}

export interface ColdRow {
    path: string;
    title: string;
    tier: "hot" | "cold";
    vec: Float32Array;
}

/**
 * Grouped global ranking (D3/D4): per top-level folder, take the group's
 * semantic top GROUP_POOL as the fusion pool, RRF-fuse with the profile's
 * keyword ranks, keep GROUP_TAKE. Groups sort by their best selected
 * member's SEMANTIC score (one common ruler across groups; fused order
 * only decides order within a group), tie → group name lexical. Empty
 * input returns [].
 */
export function groupedGlobalRank(
    coldRows: ColdRow[],
    centroid: Float32Array,
    kwRank: Map<string, number>,
    opts: { minScore: number; groupPool?: number; groupTake?: number; k?: number },
): GroupedResults[] {
    const groupPool = opts.groupPool ?? GROUP_POOL;
    const groupTake = opts.groupTake ?? GROUP_TAKE;

    const byGroup = new Map<string, Array<ColdRow & { score: number }>>();
    for (const row of coldRows) {
        if (row.vec.length !== centroid.length) continue;
        let dot = 0;
        for (let i = 0; i < row.vec.length; i++) dot += row.vec[i] * centroid[i];
        if (!Number.isFinite(dot) || dot < opts.minScore) continue;
        const group = row.path.includes("/")
            ? row.path.slice(0, row.path.indexOf("/"))
            : "/";
        const arr = byGroup.get(group);
        if (arr) arr.push({ ...row, score: dot });
        else byGroup.set(group, [{ ...row, score: dot }]);
    }

    const groups: Array<GroupedResults & { sortKey: number }> = [];
    for (const [group, arr] of byGroup) {
        arr.sort((a, b) => b.score - a.score);
        const pool = arr.slice(0, groupPool);
        const byPath = new Map(pool.map((r) => [r.path, r]));
        const fused = fuseRanks(pool.map((r) => r.path), kwRank, opts.k);
        const selected = fused.slice(0, groupTake)
            .map((p) => byPath.get(p) as ColdRow & { score: number });
        if (selected.length === 0) continue;
        groups.push({
            group,
            results: selected.map((r) => ({
                path: r.path, title: r.title, tags: [], score: r.score, tier: r.tier,
            })),
            sortKey: Math.max(...selected.map((r) => r.score)),
        });
    }
    groups.sort((a, b) => (b.sortKey - a.sortKey) || (a.group < b.group ? -1 : 1));
    return groups.map(({ group, results }) => ({ group, results }));
}
