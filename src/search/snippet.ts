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
/** Code points kept before a BM25 hit, so the hit sits in the first line or
 *  two of a row that is clamped to three lines. */
const LEAD_CHARS = 20;

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
        const real = input.bm25Real
            ? fromContent(input.bm25Real.content, input.queryTokens, true, {
                source: 'bm25', chunkIndex: input.bm25Real.chunkIndex, chunkCount: input.chunkCount,
            })
            : null;
        if (real) return real;
        if (input.bm25Desc) {
            const s = fromContent(input.bm25Desc.content, input.queryTokens, true, {
                source: 'description', chunkIndex: null, chunkCount: null,
            });
            return s && { ...s, anchor: null, anchorRatio: null };
        }
        return null;
    };
    const fromSemantic = (): SearchSnippet | null => input.semantic
        ? fromContent(input.semantic.content, input.queryTokens, false, {
            source: 'semantic', chunkIndex: input.semantic.chunkIndex, chunkCount: input.chunkCount,
        })
        : null;

    // The leg that contributed more goes first (ties to BM25, whose window
    // can open on a highlight). But a passage without a single query word
    // reads as a wrong result: when the leading leg's passage shows none and
    // the other leg's does, show the one with the words. Searching a name
    // must show the name, even if the note ranked on semantic similarity.
    const [first, second] = bm25 >= semantic ? [fromBm25(), fromSemantic()] : [fromSemantic(), fromBm25()];
    if (first && first.ranges.length === 0 && second && second.ranges.length > 0) return second;
    return first ?? second;
}

/** A single-character CJK token matches almost anywhere; it only counts
 *  when no longer token (or ASCII word) matched. */
const isStrong = (t: string) => ASCII_TOKEN.test(t) || [...t].length >= 2;

function fromContent(
    content: string,
    tokens: string[],
    centerOnHit: boolean,
    meta: Pick<SearchSnippet, 'source' | 'chunkIndex' | 'chunkCount'>,
): SearchSnippet | null {
    // Nothing to show (a title-only chunk after the prefix is stripped): let
    // the row fall back to its usual preview instead of an empty snippet.
    if (content.trim() === '') return null;

    // Match once over the whole content, so whole-word checks see the real
    // neighbours even at the window's edge.
    const strong = findHits(content, tokens.filter(isStrong));
    const hits = strong.length > 0 ? strong : findHits(content, tokens);
    const offsets = cpOffsets(content);
    const hitStart = centerOnHit && hits.length > 0 ? hits[0][0] : null;
    const [ws, we] = windowAround(offsets, hitStart);
    const inWindow = hits
        .filter(([a, b]) => b > ws && a < we)
        .map(([a, b]) => [Math.max(a, ws) - ws, Math.min(b, we) - ws] as [number, number]);
    const folded = foldWhitespace(content.slice(ws, we), inWindow);

    // The anchor starts at the hit so a jump lands on its line; near the end
    // of the chunk it reaches back instead, since a few trailing characters
    // alone would match too many other places.
    let anchorCp = hitStart === null ? 0 : cpIndexAt(offsets, hitStart);
    const n = offsets.length - 1;
    if (n - anchorCp < ANCHOR_CHARS) anchorCp = Math.max(0, n - ANCHOR_CHARS);
    const anchorStart = offsets[anchorCp];
    return {
        ...meta,
        text: folded.text,
        ranges: folded.ranges,
        anchor: content.slice(anchorStart, offsets[Math.min(n, anchorCp + ANCHOR_CHARS)]),
        anchorRatio: anchorStart / content.length,
    };
}

/** UTF-16 offset of each code point, plus content.length at the end. */
function cpOffsets(text: string): number[] {
    const offsets: number[] = [];
    let i = 0;
    for (const ch of text) {
        offsets.push(i);
        i += ch.length;
    }
    offsets.push(text.length);
    return offsets;
}

/** Index of the code point containing UTF-16 offset `pos`. */
function cpIndexAt(offsets: number[], pos: number): number {
    let c = 0;
    while (c < offsets.length - 2 && offsets[c + 1] <= pos) c++;
    return c;
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

/** A SNIPPET_WINDOW-code-point window (UTF-16 [start, end)) that opens
 *  LEAD_CHARS before `hit` when given, else at the head. */
function windowAround(offsets: number[], hit: number | null): [number, number] {
    const n = offsets.length - 1;
    const startCp = hit === null ? 0 : Math.max(0, Math.min(cpIndexAt(offsets, hit) - LEAD_CHARS, n - SNIPPET_WINDOW));
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
