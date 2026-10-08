// Canvas group labels (037) — pure, no Obsidian imports.
//
// Zoomed out, Obsidian draws only file names plus group and edge labels, and
// a group label shows about 7 CJK characters at 460px. So each card gets a
// group whose label is the note's most distinctive tags: the tag rarest on
// this canvas, then rarest in the vault. Notes without tags fall back to the
// description, minus the "本文紀錄…" style opener.

export const LABEL_MAX_WIDTH = 20;
const ELLIPSIS = "…";
const SEPARATOR = " · ";

// CJK punctuation, ideographs, Hangul, compatibility ideographs and
// full-width forms count 2; supplementary-plane Han via the Script property.
const WIDE_RE = /[　-〿㐀-鿿ꀀ-퟿豈-﫿＀-￯]|\p{Script=Han}/u;

export function labelWidth(s: string): number {
    let w = 0;
    for (const ch of s) w += WIDE_RE.test(ch) ? 2 : 1;
    return w;
}

export function truncateLabel(s: string): string {
    if (labelWidth(s) <= LABEL_MAX_WIDTH) return s;
    let out = "";
    let w = labelWidth(ELLIPSIS);
    for (const ch of s) {
        const cw = labelWidth(ch);
        if (w + cw > LABEL_MAX_WIDTH) break;
        out += ch;
        w += cw;
    }
    return out + ELLIPSIS;
}

const ZH_OPENER_RE = /^(?:本文|本篇(?:文章|筆記|笔记)?|本筆記|本笔记|這篇(?:文章|筆記)?|这篇(?:文章|笔记)?|此(?:文|篇|筆記|笔记))(?:主要|詳細|详细)?(?:紀錄|記錄|记录|探討|探讨|說明|说明|介紹|介绍|討論|讨论|整理|分析|描述|闡述|阐述|概述|總結|总结|分享)了?[：:，,、]?\s*/u;
const EN_OPENER_RE = /^This (?:note|article|post|document) (?:describes|discusses|explores|records|covers|explains|summarizes|introduces)(?:\s+|$)/iu;

export function stripDescriptionBoilerplate(desc: string): string {
    const folded = desc.replace(/\s+/g, " ").trim();
    return folded.replace(ZH_OPENER_RE, "").replace(EN_OPENER_RE, "").trim();
}

export interface LabelInput {
    tags: string[] | null;
    description: unknown;
}

/** Count key for a tag: no leading #, lower case, full nested path. */
function tagKey(tag: string): string {
    return tag.replace(/^#/, "").toLowerCase();
}

/** Distinct notes per tag: a tag repeated inside one note counts once. */
export function countTags(tagLists: Iterable<string[] | null>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const tags of tagLists) {
        if (!tags) continue;
        for (const key of new Set(tags.map(tagKey))) {
            if (key === "") continue;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return counts;
}

/** Nested tags show their last segment: 讀書/神學 → 神學. */
function displayOf(tag: string): string {
    const bare = tag.replace(/^#/, "");
    return bare.slice(bare.lastIndexOf("/") + 1);
}

export function pickGroupLabel(
    input: LabelInput,
    canvasCounts: Map<string, number>,
    vaultCounts: Map<string, number>,
): string | null {
    // Dedupe case-insensitively, keeping the note's first spelling.
    const byKey = new Map<string, string>();
    for (const tag of input.tags ?? []) {
        const key = tagKey(tag);
        if (key !== "" && displayOf(tag) !== "" && !byKey.has(key)) byKey.set(key, tag);
    }

    if (byKey.size > 0) {
        const keys = [...byKey.keys()].sort((a, b) =>
            (canvasCounts.get(a) ?? 0) - (canvasCounts.get(b) ?? 0)
            || (vaultCounts.get(a) ?? 0) - (vaultCounts.get(b) ?? 0)
            || (a < b ? -1 : a > b ? 1 : 0));
        const first = displayOf(byKey.get(keys[0])!);
        // The next tag whose shown text differs (two nested tags can share a
        // last segment); added only when the pair still fits.
        const second = keys.slice(1)
            .map((k) => displayOf(byKey.get(k)!))
            .find((d) => d.toLowerCase() !== first.toLowerCase());
        if (second !== undefined) {
            const pair = first + SEPARATOR + second;
            if (labelWidth(pair) <= LABEL_MAX_WIDTH) return pair;
        }
        return truncateLabel(first);
    }

    if (typeof input.description !== "string") return null;
    const text = stripDescriptionBoilerplate(input.description);
    return text === "" ? null : truncateLabel(text);
}
