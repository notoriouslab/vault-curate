// Canvas group labels (037) — pure, no Obsidian imports.
//
// Zoomed out, Obsidian draws only file names plus group and edge labels, and
// a group label shows about 7 CJK characters at 460px. So each card gets a
// group whose label is the note's most distinctive tags: the tag rarest on
// this canvas, then rarest in the vault. Notes without tags fall back to the
// description, minus the "本文紀錄…" style opener.

import { displayWidth } from "../utils/textWidth";

export const LABEL_MAX_WIDTH = 20;
const ELLIPSIS = "…";
const SEPARATOR = " · ";

// CJK and full-width characters count 2 (src/utils/textWidth.ts).
export function labelWidth(s: string): number {
    return displayWidth(s);
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

// 040 T9: widened after 717 gemma3:4b descriptions kept 245 stock openers
// ("這份筆記探討了…", "筆記記錄了…"); 17 left, none stripped wrongly. A bare
// 筆記 counts only when the verb takes 了, so "筆記整理術…" stays; no
// one-char verb, so "本篇談判…" is not cut into "判…".
const ZH_OPENER_VERBS = "紀錄|記錄|记录|記載|记载|探討|探讨|說明|说明|介紹|介绍|討論|讨论|整理|分析|描述|闡述|阐述|概述|總結|总结|分享"
    + "|談論|谈论|談到|谈到|談及|谈及|講述|讲述|回顧|回顾|反思|呈現|呈现|提出|聚焦|描繪|描绘|揭示|關注|关注|表達|表达|提供|報導|报导|詳述|详述|總覽|总览|關乎|关乎|針對|针对";
const ZH_OPENER_RE = new RegExp(
    "^(?:(?:本文|本篇(?:文章|筆記|笔记)?|本筆記|本笔记|(?:這|这)(?:篇|份|則|则)(?:文章|筆記|笔记)?|此(?:文|篇|筆記|笔记))(?:內容|内容)?(?:主要|詳細|详细|深入|簡要|简要|旨在)?(?:" + ZH_OPENER_VERBS + ")了?"
    + "|(?:筆記|笔记)(?:內容|内容)?(?:主要|詳細|详细|深入|簡要|简要)?(?:" + ZH_OPENER_VERBS + ")了)[：:，,、]?\\s*",
    "u",
);
// 040 D5: widened after gemma3:4b opened 24 of 36 English descriptions this way.
const EN_OPENER_RE = /^(?:This|The) (?:note|article|post|document|entry|essay) (?:describes|discusses|explores|records|covers|explains|summarizes|introduces|details|outlines|examines|presents|highlights|documents|reflects|analyzes|shares|recounts|reviews|chronicles)(?:\s+|$)/iu;

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
