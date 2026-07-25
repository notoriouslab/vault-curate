// Relatedness fusion (011) — pure functions, no Obsidian imports.
//
// Note-level cosine alone is register-dominated: same-prose-style notes
// cluster and drown the topic words. Fix: RRF-fuse the anchor note's
// lexical signal (tags pseudo-query through BM25) with the cosine order.
// Fusion only REORDERS the pool that already passed minScore — a keyword
// hit can never pull in a semantically unrelated note, and with no hits
// the output equals the cosine order. Deliberately separate from
// rrfFuse.ts (the score-map, unbounded-pool variant used by search).
// Design + tuning evidence: openspec/changes/011-relatedness-fusion/.

/** RRF constant, same value as search (sweep-validated). */
const RRF_K = 60;
/** Fusion pool size: top-N of the minScore-filtered cosine order. */
export const FUSION_POOL = 100;
/** BM25 result depth for the keyword ranking, in CHUNK hits — one
 *  strong note can occupy a dozen chunk slots, so this sits well above
 *  FUSION_POOL to keep note-level coverage after dedupe (design D2/D3;
 *  the tuning sweep ran at this value). */
export const KW_POOL = 500;

/** Frontmatter tag shape defense (single source of truth, 011 D1 / 012
 *  D2): array → keep string elements trimmed; string → comma-split;
 *  anything else → no tags. */
export function parseTags(tags: unknown): string[] {
    if (Array.isArray(tags)) {
        return tags.filter((t): t is string => typeof t === "string")
            .map((t) => t.trim()).filter(Boolean);
    }
    if (typeof tags === "string") {
        return tags.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Pseudo-query for the anchor note (D1): frontmatter tags REPLACE the
 * title when present — the title carries the very register the fusion
 * exists to defeat (a "…導入規畫書" title feeds plan-doc trigrams back
 * into BM25); tags are curated topic words. Title is the fallback when
 * no tags. Tokenization is the caller's job.
 */
export function buildPseudoQuery(basename: string, tags: unknown): string {
    const tagText = parseTags(tags).join(" ");
    return tagText === "" ? basename : tagText;
}

/**
 * RRF re-rank of the fusion pool (D3, complete definition):
 *   fused(p) = 1/(k + cosRank(p)) + 1/(k + kwRank(p))
 * cosRank = 1-based position in `cosRankedPaths` (unique by construction);
 * kwRank = 1-based BM25 position, contributing 0 when the path has no
 * keyword hit. Ties (symmetric rank pairs) resolve to the smaller cosRank,
 * so the output is fully deterministic. Empty input returns empty; an
 * empty kwRank map returns the input order unchanged.
 */
export function fuseRanks(
    cosRankedPaths: string[],
    kwRank: Map<string, number>,
    k: number = RRF_K,
): string[] {
    return cosRankedPaths
        .map((path, i) => {
            const cosRank = i + 1;
            const kr = kwRank.get(path);
            const fused = 1 / (k + cosRank) + (kr !== undefined ? 1 / (k + kr) : 0);
            return { path, cosRank, fused };
        })
        .sort((a, b) => (b.fused - a.fused) || (a.cosRank - b.cosRank))
        .map((x) => x.path);
}
