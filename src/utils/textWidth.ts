// Display width shared by Canvas labels (037) and description trimming (040).
// Pure, no Obsidian imports.

// CJK punctuation, kana, bopomofo, ideographs, Hangul, compatibility
// ideographs and full-width forms count 2; supplementary-plane Han via the
// Script property.
export const WIDE_RE = /[\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3400-\u9FFF\uA000-\uD7FF\uF900-\uFAFF\uFF00-\uFFEF]|\p{Script=Han}/u;

export function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s) w += WIDE_RE.test(ch) ? 2 : 1;
    return w;
}
