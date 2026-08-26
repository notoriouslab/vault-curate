/**
 * preproc — Traditional→Simplified conversion for embedding input (008).
 *
 * Why: bge-small-zh is trained predominantly on Simplified Chinese.
 * Converting the EMBEDDING INPUT (never the stored text, BM25 corpus, LLM
 * prompts, or anything user-visible) moves vectors into the model's
 * best-trained token space. Measured on the dogfood vault
 * (openspec/research/2026-07-18-s2t-embedding-pilot.md): positives hold or
 * improve, unrelated hub notes drop 3-4x in rank, template similarity −0.03.
 *
 * Scope discipline (design 008 D3, amended by 029): five call sites convert —
 * indexOne chunk embeds, indexOne description embed, backfill description
 * embeds, the search query embed, and (since 029) normalizeForSearch in
 * storage/bm25.ts, which folds variants for the keyword leg. The LLM path
 * (description generator) MUST stay Traditional: converting it would write
 * Simplified descriptions back into the vault.
 *
 * T2S_VERSION is bound to the generated table (t2sTable.ts) — regenerating
 * the table MUST bump it; the upgrade re-embed scan in Indexer.update()
 * keys off this value, same pattern as DENOISE_VERSION.
 */
import { T2S_TABLE } from './t2sTable';

export const T2S_VERSION = "1";

/**
 * Char-level Traditional→Simplified. Code-point iteration (surrogate-safe);
 * characters outside the table pass through unchanged, so non-CJK text is
 * returned as-is (aside from a fresh string copy).
 */
export function t2sForEmbed(text: string): string {
    let out = '';
    for (const ch of text) {
        out += T2S_TABLE[ch] ?? ch;
    }
    return out;
}

// CJK Unified Ideographs (BMP block). Ext-B+ rarities are not worth the
// scan cost — a note that ONLY contains ext-B hanzi won't convert anyway
// (table coverage there is sparse), so skipping it is consistent.
// RegExp-constructor form keeps this source file plain ASCII.
const CJK_RE = new RegExp("[\\u4E00-\\u9FFF]");

/** Upgrade-scan predicate (008 D4): does this text contain CJK hanzi? */
export function hasCJK(text: string): boolean {
    return CJK_RE.test(text);
}
