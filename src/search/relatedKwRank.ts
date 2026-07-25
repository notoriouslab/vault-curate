// Keyword ranking for relatedness fusion (011 D2) and the global-discover
// profile (012) — the store-facing half. Runs a pseudo-query through the
// existing memoized BM25 index (chunk-level hits) and collapses to a
// note-level rank map by first-seen dedupe in ranked order.

import type { SQLiteStore } from "../storage/SQLiteStore";
import { buildPseudoQuery, KW_POOL } from "./relatedFusion";

/**
 * Note-level keyword ranks for an arbitrary pseudo-query. `excludePath`
 * is skipped BEFORE rank numbering so the remaining ranks stay contiguous
 * (a post-hoc delete would leave a gap and shift RRF weights).
 *
 * Perf guard (011 review C1/C2): the BM25 first build is a synchronous
 * seconds-scale main-thread job and this sits on passive paths — never
 * trigger the build from here. Cold index → empty map → pure-cosine
 * degradation; the background sliced warm closes the gap.
 */
export function kwRankForQuery(
    store: SQLiteStore,
    query: string,
    excludePath?: string,
): Map<string, number> {
    if (!store.isBM25Warm()) return new Map();
    if (query.trim() === "") return new Map();

    const hits = store.searchBM25(query, KW_POOL);
    const rankByPath = new Map<string, number>();
    let rank = 1;
    for (const hit of hits) {
        if (hit.notePath === excludePath) continue;
        if (!rankByPath.has(hit.notePath)) {
            rankByPath.set(hit.notePath, rank++);
        }
    }
    return rankByPath;
}

/** Anchor-note variant (011): pseudo-query from the note's tags (title
 *  fallback), the anchor itself excluded — its own keywords trivially
 *  match itself, zero information. */
export function relatedKwRank(
    store: SQLiteStore,
    anchorPath: string,
    basename: string,
    tags: unknown,
): Map<string, number> {
    return kwRankForQuery(store, buildPseudoQuery(basename, tags), anchorPath);
}
