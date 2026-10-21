// Frontmatter-safety primitives. Pure (no obsidian import) so both the
// curation code and its unit tests can use them — description-generator.ts
// imports obsidian, which vitest can't resolve, so anything that needs a
// test lives here instead.

import { displayWidth } from "./textWidth";

// Hard cap applied while parsing an LLM reply (guards a runaway reply); the
// stored length is set by trimDescription below (040 D3).
export const DESCRIPTION_LENGTH_CAP = 1000;
// Display width (CJK counts 2): about 500 English chars or 250 Chinese chars.
export const DESCRIPTION_WIDTH_CAP = 500;
export const TAG_LENGTH_CAP = 64;

/**
 * Match every control / line-break code point that YAML or downstream
 * UI rendering might choke on, BUT preserve common whitespace
 * (\x09 tab, \x0a LF, \x0d CR) so multi-line markdown descriptions
 * survive intact.
 *
 * Built via RegExp constructor with concatenated escape strings so the
 * source file stays plain ASCII (Edit/Write tools decode raw \uXXXX in
 * regex literals, which corrupted earlier versions).
 */
// Cc + Cf cover all ASCII control codes, C1 controls, zero-width chars,
// bidi controls (incl. RLO), BOM, word joiner, bidi isolates, interlinear
// annotation, and the Plane-14 tag block. Using \p{...} keeps the character
// class clean of combining marks so the no-misleading-character-class rule
// stays happy.
export const STRIP_CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;

// Combining marks (Mn category) used for invisible spoofing — listed via
// alternation rather than a character class so the lint rule doesn't trip on
// combining marks grouped together.
export const STRIP_COMBINING_INVISIBLES = new RegExp(
    "\\u034f"                                                                       // CGJ
    + "|\\u180b|\\u180c|\\u180d"                                                    // Mongolian FVS
    + "|\\ufe00|\\ufe01|\\ufe02|\\ufe03|\\ufe04|\\ufe05|\\ufe06|\\ufe07"             // VS1-VS8
    + "|\\ufe08|\\ufe09|\\ufe0a|\\ufe0b|\\ufe0c|\\ufe0d|\\ufe0e|\\ufe0f",            // VS9-VS16
    "gu",
);

// Plane 14 Unicode Tag block (U+E0000-U+E007F). RegExp constructor with \u{}
// escapes; `u` flag puts the regex in code-point mode so the range matches
// as a single codepoint rather than two surrogate halves.
export const STRIP_UNICODE_TAGS = new RegExp("[\\u{E0000}-\\u{E007F}]", "gu");

/** Strip dangerous invisible code points (control, format, combining marks, tags). */
export function stripDangerousInvisibles(text: string, replacement = ""): string {
    return text
        .replace(STRIP_CONTROL_CHARS, replacement)
        .replace(STRIP_COMBINING_INVISIBLES, "")
        .replace(STRIP_UNICODE_TAGS, "");
}

/** Slice text safely without splitting a UTF-16 surrogate pair. */
export function safeSlice(text: string, max: number): string {
    if (max <= 0) return "";
    if (text.length <= max) return text;
    let cut = max;
    // If we landed on a high surrogate, back off one code unit.
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
    return text.slice(0, cut);
}

// Sentence ends for trimDescription (040 D3). A full-width stop needs nothing
// after it (Chinese runs straight into the next sentence); a half-width stop
// must be followed by whitespace or the end, so "1.5" is not an end. Closing
// quotes and brackets right after the stop stay with the sentence. Escaped so
// this file stays plain ASCII.
const FULL_STOPS = "\u3002\uFF01\uFF1F";
const FULL_CLOSERS = "\u300D\u300F\uFF09\"'\u201D\u2019";
const HALF_STOPS = ".!?";
const HALF_CLOSERS = ")\"'\u300D\u300F\uFF09\u201D\u2019";
const ELLIPSIS = "\u2026";
const SENTENCE_END_RE = new RegExp(
    "[" + FULL_STOPS + "][" + FULL_CLOSERS + "]*"
    + "|[" + HALF_STOPS.replace(/[.?]/g, "\\$&") + "][" + HALF_CLOSERS.replace(/[)]/g, "\\$&") + "]*(?=\\s|$)",
    "gu",
);
// A description ending in one of these was not cut mid-sentence (040 D6).
// Must match every sentence end and closer above, plus the trim ellipsis.
const SAFE_ENDINGS = new Set([...FULL_STOPS, ...HALF_STOPS, ...FULL_CLOSERS, ...HALF_CLOSERS, ELLIPSIS]);

/**
 * Fit a description into DESCRIPTION_WIDTH_CAP by cutting after the last
 * sentence end that fits; with no sentence end in the second half, cut at the
 * cap and add an ellipsis (one early "Hi." must not throw the rest away).
 * Sentence ends are searched in the whole text, not the cut prefix, so "1.5"
 * cut to "1." is never taken for an end. Known limit: abbreviations such as
 * "e.g." or "Dr." count as sentence ends. The result is never one that
 * isLegacyTruncatedDescription flags, or every batch would regenerate it.
 */
export function trimDescription(desc: string, cap: number = DESCRIPTION_WIDTH_CAP): string {
    return unlikeLegacyCut(fitWidth(desc, cap));
}

function fitWidth(desc: string, cap: number): string {
    if (displayWidth(desc) <= cap) return desc;
    let best = -1;
    SENTENCE_END_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END_RE.exec(desc)) !== null) {
        const end = m.index + m[0].length;
        if (displayWidth(desc.slice(0, end)) > cap) break;
        best = end;
    }
    if (best > 0 && displayWidth(desc.slice(0, best)) * 2 >= cap) return desc.slice(0, best).trimEnd();
    let out = "";
    let w = 0;
    for (const ch of desc) {
        const cw = displayWidth(ch);
        if (w + cw > cap - 1) break;
        out += ch;
        w += cw;
    }
    return out.trimEnd() + ELLIPSIS;
}

// A description of exactly 499/500 code units with no sentence end looks like
// the old cut (040 D6); swap its last char for an ellipsis (040 review).
function unlikeLegacyCut(desc: string): string {
    if (!isLegacyTruncatedDescription(desc)) return desc;
    const chars = Array.from(desc.trimEnd());
    chars.pop();
    return chars.join("") + ELLIPSIS;
}

/**
 * True for a description an earlier version cut at 500 UTF-16 units
 * mid-sentence (499 when the cut backed off a surrogate pair), so batch
 * generation can repair it (040 D6).
 */
export function isLegacyTruncatedDescription(desc: unknown): boolean {
    if (typeof desc !== "string") return false;
    if (desc.length !== 500 && desc.length !== 499) return false;
    const last = Array.from(desc.trimEnd()).pop();
    return last !== undefined && !SAFE_ENDINGS.has(last);
}
