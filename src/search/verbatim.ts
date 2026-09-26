/**
 * 038: verbatim-match boost. A query that is literally a note's title
 * opening, one of its headings, or a "quoted" phrase from its text lifts that
 * note by one first-place share of the fusion (1/(k+1)), so an exact match is
 * not outranked by notes that are merely similar in meaning.
 *
 * Matching is literal: ASCII letters are case-folded, everything else is
 * compared as typed (no Traditional/Simplified folding, no synonyms).
 */
import { RRF_K } from './rrfFuse';

/** A date-style title prefix, e.g. "20260329-" or "2026-09-18 ". */
export const DATE_PREFIX_RE = /^(\d{8}[-_ ]?|\d{4}-\d{2}-\d{2}\s*)/;
const ASCII_WORD = /^[a-z0-9_-]+$/;
const WORD_CHAR = /[a-z0-9_-]/;
const CODE_FENCE = /```[\s\S]*?```/g;

export function foldAscii(s: string): string {
    return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Null below two code points. A query wrapped in ASCII double quotes is a
 *  phrase to find in the text; anything else is matched as typed. */
export function parseVerbatimQuery(q: string): { phrase: string; quoted: boolean } | null {
    const s = q.trim();
    const quoted = s.length >= 2 && s.startsWith('"') && s.endsWith('"');
    const phrase = quoted ? s.slice(1, -1) : s;
    if ([...phrase].length < 2) return null;
    return { phrase, quoted };
}

export function titleStartsWith(title: string, phrase: string): boolean {
    const t = foldAscii(title);
    const p = foldAscii(phrase);
    return t.startsWith(p) || t.replace(DATE_PREFIX_RE, '').startsWith(p);
}

/** A whole line `#… phrase`, outside fenced code, never spanning lines. */
export function hasHeadingLine(content: string, phrase: string): boolean {
    const escaped = foldAscii(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = new RegExp(`^#{1,6}[^\\S\\n]+${escaped}[^\\S\\n]*$`, 'm');
    return line.test(foldAscii(content).replace(CODE_FENCE, ''));
}

/** An all-ASCII-word phrase must match whole words (the same rule the
 *  snippet highlighter uses); anything else matches as a substring. */
export function containsPhrase(content: string, phrase: string): boolean {
    const c = foldAscii(content);
    const p = foldAscii(phrase);
    if (!ASCII_WORD.test(p)) return c.includes(p);
    for (let i = c.indexOf(p); i >= 0; i = c.indexOf(p, i + 1)) {
        const end = i + p.length;
        if ((i === 0 || !WORD_CHAR.test(c[i - 1])) && (end === c.length || !WORD_CHAR.test(c[end]))) return true;
    }
    return false;
}

/** Each hit gains 1/(k+1) once; a hit no leg found enters at zero first. */
export function applyVerbatimBoost(
    fused: Map<string, number>,
    hits: Set<string>,
    k: number = RRF_K,
): Map<string, number> {
    const out = new Map(fused);
    for (const path of hits) out.set(path, (out.get(path) ?? 0) + 1 / (k + 1));
    return out;
}
