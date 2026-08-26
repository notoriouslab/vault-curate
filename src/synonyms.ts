/**
 * Expand a query with user-defined synonyms. If any key appears in the
 * query, append its synonyms so the BM25 and semantic legs can reach
 * notes that only use the other form. E.g. query "小陳" with
 * {"小陳": ["陳大文"]} becomes "小陳 陳大文".
 *
 * Wired in v0.1.0, lost in the Phase 5 hybrid-fusion rewrite (78f808f),
 * re-wired 2026-08-25 — the fuzzy-title leg deliberately keeps the raw
 * query (appended words would poison title matching).
 */
import { normalizeForSearch } from "./storage/bm25";

export function expandQuery(query: string, synonyms: Record<string, string[]> | undefined): string {
    if (!synonyms || Object.keys(synonyms).length === 0) return query;

    // 1.7.0 review follow-up: match in the same folded space the BM25 leg
    // searches in (029), so a dict key spelled 計劃 still fires on a query
    // typed 計畫 — the trigger must never be stricter than the search it
    // feeds. Appended words stay in their original spelling; tokenization
    // folds them again anyway.
    const q = normalizeForSearch(query);
    const additions: string[] = [];
    for (const [key, values] of Object.entries(synonyms)) {
        // '' .includes('') is always true — an empty key (unreachable via the
        // settings UI, possible via a hand-edited data.json) would append its
        // values to EVERY query (red-team W2). Defense in depth.
        if (!key) continue;
        if (!q.includes(normalizeForSearch(key))) continue;
        for (const v of values) {
            if (!v) continue;
            const vf = normalizeForSearch(v);
            if (!q.includes(vf) && !additions.some((a) => normalizeForSearch(a) === vf)) {
                additions.push(v);
            }
        }
    }

    return additions.length > 0 ? `${query} ${additions.join(" ")}` : query;
}
