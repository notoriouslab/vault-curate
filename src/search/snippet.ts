/**
 * Search result snippets (034 D3): show the passage that earned the note its
 * rank, with the query highlighted.
 *
 * The passage is the winning chunk of whichever retrieval leg contributed
 * more to the note's fused score, so what is shown is what was scored (the
 * 025 lesson: display granularity must equal computation granularity).
 *
 * Highlighting matches BM25 query tokens against the text after the same
 * folding BM25 uses (Traditional → Simplified, 画 → 划, ASCII lowercase).
 * Folding is one code point to one code point, but a code point's UTF-16
 * length can change (some characters map across the BMP boundary), so every
 * match is mapped back to the original text through a per-unit offset table
 * instead of reusing the folded string's indices.
 */
import type { SearchSnippet } from '../types';
import { normalizeForSearch } from '../storage/bm25';

/** Window length, in code points. */
export const SNIPPET_WINDOW = 120;
/** Anchor length for jumping, in code points. */
export const ANCHOR_CHARS = 40;

export interface LegHit {
    chunkIndex: number;
    /** Chunk text with the title prefix already removed (stripChunkPrefix). */
    content: string;
}

export interface SnippetInput {
    /** tokenizeForBM25 of the query as the BM25 leg searched it (synonyms included). */
    queryTokens: string[];
    /** This note's 1-based rank in each leg (rankMap), null when the leg missed it. */
    bm25Rank: number | null;
    semanticRank: number | null;
    /** Highest-scoring real chunk in the BM25 leg. */
    bm25Real: LegHit | null;
    /** Description text, used only when no real chunk matched the keywords. */
    bm25Desc: { content: string } | null;
    semantic: LegHit | null;
    /** Same weights and k as the fusion (readHybridWeights, 60). */
    weights: { bm25: number; semantic: number };
    k: number;
    chunkCount: number | null;
}

const ASCII_TOKEN = /^[a-z0-9_-]+$/;
// Same class as cjkTokenize's ASCII_WORD_RE: an ASCII token only counts as a
// whole word, so "ai" does not light up inside "maintain".
const WORD_CHAR = /[a-z0-9_-]/;
const WHITESPACE = /\s/;

export function buildSnippet(input: SnippetInput): SearchSnippet | null {
    const bm25 = input.bm25Rank ? input.weights.bm25 / (input.k + input.bm25Rank) : 0;
    const semantic = input.semanticRank ? input.weights.semantic / (input.k + input.semanticRank) : 0;
    if (bm25 === 0 && semantic === 0) return null; // title-only match

    const fromBm25 = (): SearchSnippet | null => {
        if (input.bm25Real) {
            return fromContent(input.bm25Real.content, input.queryTokens, true, {
                source: 'bm25', chunkIndex: input.bm25Real.chunkIndex, chunkCount: input.chunkCount,
            });
        }
        if (input.bm25Desc) {
            const s = fromContent(input.bm25Desc.content, input.queryTokens, true, {
                source: 'description', chunkIndex: null, chunkCount: null,
            });
            return { ...s, anchor: null };
        }
        return null;
    };
    const fromSemantic = (): SearchSnippet | null => input.semantic
        ? fromContent(input.semantic.content, input.queryTokens, false, {
            source: 'semantic', chunkIndex: input.semantic.chunkIndex, chunkCount: input.chunkCount,
        })
        : null;

    // Ties go to BM25: its window can be centred on a highlight.
    return bm25 >= semantic ? (fromBm25() ?? fromSemantic()) : (fromSemantic() ?? fromBm25());
}

function fromContent(
    content: string,
    tokens: string[],
    centerOnHit: boolean,
    meta: Pick<SearchSnippet, 'source' | 'chunkIndex' | 'chunkCount'>,
): SearchSnippet {
    const hits = findHits(content, tokens);
    const hitStart = centerOnHit && hits.length > 0 ? hits[0][0] : null;
    const [ws, we] = windowAround(content, hitStart);
    const windowText = content.slice(ws, we);
    const folded = foldWhitespace(windowText, findHits(windowText, tokens));
    return {
        ...meta,
        text: folded.text,
        ranges: folded.ranges,
        // Start the anchor at the hit so a jump lands on its line.
        anchor: takeCodePoints(content.slice(hitStart ?? 0), ANCHOR_CHARS),
    };
}

/** Every whole-token match in `text`, as merged UTF-16 ranges of `text`. */
function findHits(text: string, tokens: string[]): Array<[number, number]> {
    let norm = '';
    const starts: number[] = [];
    const ends: number[] = [];
    let i = 0;
    for (const ch of text) {
        const n = normalizeForSearch(ch).replace(/[A-Z]/g, (c) => c.toLowerCase());
        for (let u = 0; u < n.length; u++) {
            starts.push(i);
            ends.push(i + ch.length);
        }
        norm += n;
        i += ch.length;
    }

    const hits: Array<[number, number]> = [];
    for (const tok of new Set(tokens)) {
        if (!tok) continue;
        const ascii = ASCII_TOKEN.test(tok);
        for (let j = norm.indexOf(tok); j >= 0; j = norm.indexOf(tok, j + 1)) {
            const end = j + tok.length;
            if (ascii && ((j > 0 && WORD_CHAR.test(norm[j - 1])) || (end < norm.length && WORD_CHAR.test(norm[end])))) {
                continue;
            }
            hits.push([starts[j], ends[end - 1]]);
        }
    }
    return mergeRanges(hits);
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out: Array<[number, number]> = [];
    for (const [a, b] of sorted) {
        const last = out[out.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out;
}

/** A SNIPPET_WINDOW-code-point window of `text` (UTF-16 [start, end)),
 *  centred on `center` when given, else starting at the head. */
function windowAround(text: string, center: number | null): [number, number] {
    const offsets: number[] = [];
    let i = 0;
    for (const ch of text) {
        offsets.push(i);
        i += ch.length;
    }
    offsets.push(text.length);
    const n = offsets.length - 1;
    let startCp = 0;
    if (center !== null) {
        let c = 0;
        while (c < n && offsets[c + 1] <= center) c++;
        startCp = Math.max(0, Math.min(c - Math.floor(SNIPPET_WINDOW / 2), n - SNIPPET_WINDOW));
    }
    const endCp = Math.min(n, startCp + SNIPPET_WINDOW);
    return [offsets[startCp], offsets[endCp]];
}

/** Collapse whitespace runs to one space, drop leading and trailing
 *  whitespace, and move `ranges` along. Tokens never contain whitespace, so
 *  no range starts or ends inside a collapsed run. */
function foldWhitespace(s: string, ranges: Array<[number, number]>): { text: string; ranges: Array<[number, number]> } {
    let out = '';
    const map = new Array<number>(s.length + 1);
    let pendingSpace = false;
    for (let i = 0; i < s.length; i++) {
        if (WHITESPACE.test(s[i])) {
            map[i] = out.length;
            pendingSpace = true;
            continue;
        }
        if (pendingSpace && out.length > 0) out += ' ';
        pendingSpace = false;
        map[i] = out.length;
        out += s[i];
    }
    map[s.length] = out.length;
    return { text: out, ranges: ranges.map(([a, b]) => [map[a], map[b]] as [number, number]) };
}

function takeCodePoints(s: string, n: number): string {
    let out = '';
    let count = 0;
    for (const ch of s) {
        if (count++ >= n) break;
        out += ch;
    }
    return out;
}
