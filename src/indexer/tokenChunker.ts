/**
 * tokenChunker — token-budgeted splitter for the built-in embedding model (034 D1).
 *
 * Why: transformers.js calls the tokenizer with `truncation: true`, so any
 * chunk past the model's 512-token window is silently cut. The fixed
 * 2000-char chunks from chunker.ts are ~1400 tokens of Chinese, which left
 * over half of the indexed text out of the vectors. This splitter sizes each
 * window by actual token count instead of characters.
 *
 * Contract mirrors splitChunks (chunker.ts): body is trimmed, an empty body
 * yields one title-only chunk, `chunkIndex` is 0-based and contiguous, and
 * each chunk's content is `prefix + slice`. Only the prefix differs: long
 * titles are cut to `maxTitleChars` code points (see chunkTitlePrefix).
 *
 * All positions are code points, so a window never splits a surrogate pair.
 */
import type { Chunk } from './chunker';

export const TOKEN_CHUNK_POLICY = "tok512-v1";

export interface TokenChunkOptions {
    /** Token budget per chunk, prefix and special tokens included. */
    maxTokens: number;
    /** Code points shared by adjacent chunks (capped at half a window). */
    overlapChars: number;
    /** Upper bound on a window's slice length, in code points. */
    maxWindowChars: number;
    /** Title code points kept in the prefix. */
    maxTitleChars: number;
}

// A window prefers to end right after one of these.
const BOUNDARY = new Set(["\n", "。", "！", "？", ".", "!", "?"]);
// How far back (as a fraction of the window) the boundary search may move the cut.
const BOUNDARY_FLOOR = 0.8;

/**
 * The prefix a chunk carries: the title (newlines folded to spaces, cut to
 * `maxTitleChars` code points) plus "\n", or "" for an empty title. Pass
 * `Infinity` for the full title.
 */
export function chunkTitlePrefix(title: string, maxTitleChars: number): string {
    if (!title) return "";
    const cps = [...title.replace(/[\r\n]/g, " ")];
    const kept = cps.length > maxTitleChars ? cps.slice(0, maxTitleChars) : cps;
    return kept.join("") + "\n";
}

/**
 * Remove whichever title prefix a stored chunk carries. Three spellings exist
 * side by side: the truncated token-policy prefix, the full title with
 * newlines folded, and the raw `title + "\n"` that splitChunks writes for
 * external providers. Mid-upgrade an index holds more than one, so this
 * checks all of them instead of trusting the index's policy stamp.
 */
export function stripChunkPrefix(content: string, title: string): string {
    const candidates = [
        chunkTitlePrefix(title, 64),
        chunkTitlePrefix(title, Infinity),
        title ? `${title}\n` : "",
    ];
    for (const p of candidates) {
        if (p && content.startsWith(p)) return content.slice(p.length);
    }
    return content;
}

/**
 * Split `body` into windows of at most `opts.maxTokens` tokens each, as
 * measured by `countTokens` on the full chunk text (prefix included).
 *
 * The window length is found by binary search. Token counts are not strictly
 * monotonic in length (WordPiece can merge a word once it is complete), so
 * the search only guarantees the returned length passed the budget check,
 * not that it is the longest such length. A length of 1 is the floor, so the
 * loop always advances even when the prefix alone exceeds the budget.
 */
export function splitChunksByTokens(
    body: string,
    title: string,
    countTokens: (s: string) => number,
    opts: TokenChunkOptions,
): Chunk[] {
    const trimmed = body.trim();
    const prefix = chunkTitlePrefix(title, opts.maxTitleChars);

    if (trimmed.length === 0) {
        return [{ content: prefix.trimEnd(), chunkIndex: 0 }];
    }
    if (countTokens(prefix + trimmed) <= opts.maxTokens) {
        return [{ content: prefix + trimmed, chunkIndex: 0 }];
    }

    const cps = [...trimmed];
    const fits = (start: number, len: number) =>
        countTokens(prefix + cps.slice(start, start + len).join("")) <= opts.maxTokens;

    const out: Chunk[] = [];
    let start = 0;
    while (start < cps.length) {
        // Longest length that passed the check (or 1 if none did).
        let lo = 1;
        let hi = Math.min(Math.max(1, opts.maxWindowChars), cps.length - start);
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (fits(start, mid)) lo = mid;
            else hi = mid - 1;
        }
        let len = lo;

        // Prefer cutting right after a sentence boundary, within the last 20%.
        if (start + len < cps.length) {
            const floor = Math.max(1, Math.ceil(len * BOUNDARY_FLOOR));
            for (let k = len; k >= floor; k--) {
                if (BOUNDARY.has(cps[start + k - 1])) {
                    // A shorter slice ending at a boundary should never cost more
                    // tokens, but the budget is an invariant, so check it.
                    if (k !== len && fits(start, k)) len = k;
                    break;
                }
            }
        }

        out.push({ content: prefix + cps.slice(start, start + len).join(""), chunkIndex: out.length });
        if (start + len >= cps.length) break;
        // Overlap never exceeds half the window, so each step advances by
        // at least ceil(len / 2) >= 1 and never skips past this window's end.
        const overlap = Math.min(opts.overlapChars, Math.floor(len / 2));
        start += len - overlap;
    }
    return out;
}
