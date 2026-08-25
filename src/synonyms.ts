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
export function expandQuery(query: string, synonyms: Record<string, string[]> | undefined): string {
    if (!synonyms || Object.keys(synonyms).length === 0) return query;

    const additions: string[] = [];
    for (const [key, values] of Object.entries(synonyms)) {
        if (query.includes(key)) {
            for (const v of values) {
                if (v && !query.includes(v) && !additions.includes(v)) {
                    additions.push(v);
                }
            }
        }
    }

    return additions.length > 0 ? `${query} ${additions.join(" ")}` : query;
}
