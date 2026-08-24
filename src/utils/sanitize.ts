// Frontmatter-safety primitives. Pure (no obsidian import) so both the
// curation code and its unit tests can use them — description-generator.ts
// imports obsidian, which vitest can't resolve, so anything that needs a
// test lives here instead.

export const DESCRIPTION_LENGTH_CAP = 500;
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

/** Tail counterpart of safeSlice: last `max` code units, surrogate-safe. */
export function safeTail(text: string, max: number): string {
    if (max <= 0) return "";
    if (text.length <= max) return text;
    let start = text.length - max;
    // If we landed on a low surrogate, skip forward one code unit.
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) start++;
    return text.slice(start);
}
