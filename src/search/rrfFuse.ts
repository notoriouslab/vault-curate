/**
 * Reciprocal Rank Fusion (RRF) for hybrid search.
 *
 * Design rationale: see openspec/changes/004-vault-curate-rebrand/design.md D6.
 *
 * Each retriever supplies a Map<docId, score>. We rank within each retriever
 * (higher input score = lower rank index) and accumulate
 *     fused[doc] = Σ weight[i] / (k + rank + 1)
 * Standard k = 60 (TREC literature). Higher weight on a retriever amplifies
 * its rank contribution without re-normalising heterogeneous score scales —
 * that's the whole reason RRF wins over linear combination on BM25 + cosine.
 */

/** 1-based rank of each doc within one retriever: sorted by score descending,
 *  ties kept in insertion order (Array.prototype.sort is stable). rrfFuse and
 *  the snippet leg choice (034 D3) both rank through this, so they agree. */
export function rankMap(results: Map<string, number>): Map<string, number> {
    const ranked = Array.from(results.entries()).sort((a, b) => b[1] - a[1]);
    const out = new Map<string, number>();
    ranked.forEach(([docId], i) => out.set(docId, i + 1));
    return out;
}

/** Fuse N ranked retriever outputs. Returns docId → fused score (descending). */
export function rrfFuse(
    results: Map<string, number>[],
    weights: number[],
    k: number = 60,
): Map<string, number> {
    if (results.length !== weights.length) {
        throw new Error(
            `rrfFuse: results.length (${results.length}) !== weights.length (${weights.length})`,
        );
    }
    const fused = new Map<string, number>();
    for (let i = 0; i < results.length; i++) {
        const w = weights[i];
        if (w === 0) continue; // disabled retriever contributes nothing
        for (const [docId, rank] of rankMap(results[i])) {
            fused.set(docId, (fused.get(docId) ?? 0) + w / (k + rank));
        }
    }
    return fused;
}

/** Sort a fused-score map into descending list and take the top N. */
export function topNFused(
    fused: Map<string, number>,
    n: number,
): Array<{ docId: string; score: number }> {
    return Array.from(fused.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([docId, score]) => ({ docId, score }));
}
