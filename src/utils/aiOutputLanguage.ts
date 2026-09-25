// 036: which language the LLM writes descriptions, tags and MOC group names
// in, independent of the interface language (issue #15). Pure — no `t`, no
// obsidian import — so the resolution rules are unit-testable.

import type { Locale } from "../i18n";
import { stripDangerousInvisibles } from "./sanitize";

export type AiOutputLanguage = "auto" | "en" | "zh-TW" | "zh-CN" | "custom";
export const AI_OUTPUT_LANGUAGES: readonly AiOutputLanguage[] = ["auto", "en", "zh-TW", "zh-CN", "custom"];
export const CUSTOM_LANGUAGE_MAX_CHARS = 40;

/** Anything outside the list (hand-edited data.json, wrong case) → "auto". */
export function normalizeAiOutputLanguage(raw: unknown): AiOutputLanguage {
    return (AI_OUTPUT_LANGUAGES as readonly unknown[]).includes(raw) ? raw as AiOutputLanguage : "auto";
}

/** Make a user-typed language name safe to splice into a prompt: no line
 *  breaks or invisibles (they'd break the prompt's structure), one space
 *  between words, at most 40 code points. Known trade-off: ZWJ/ZWNJ are Cf
 *  and become spaces too, which splits the rare language name that needs
 *  them (036 D6). */
export function sanitizeCustomLanguage(raw: unknown): string {
    if (typeof raw !== "string") return "";
    const flat = stripDangerousInvisibles(raw, " ").replace(/\s+/g, " ").trim();
    return [...flat].slice(0, CUSTOM_LANGUAGE_MAX_CHARS).join("").trim();
}

// The two custom templates are en's prompts with only the language lines
// changed (036 D3); en's own prompts stay untouched so "auto"/"en" users
// send exactly what they sent before.
export function customDescriptionPrompt(language: string, title: string, content: string): string {
    return `Task: Generate a description and tags for this note.

Rules:
1. Description in ${language}, 50-100 words or equivalent length
2. Description must describe specific content, never repeat the title
3. Describe only the note's subject matter — never its format or structure (tables, statistics, charts, sections)
4. Tags in ${language}, 3-5 tags, no # prefix, no spaces
5. Start directly with the subject; never open with filler such as "This note", "This article" or "This document"
6. Reply only in JSON

{"description": "...", "tags": ["...", "...", "..."]}

Note title: ${title}

Note content:
${content}`;
}

export function customMocNamingPrompt(language: string, notesBlock: string): string {
    return `You are organizing a knowledge vault. Below are notes that have been grouped together because they discuss related topics. Based on the common theme, produce:

- title: a concise heading (3-8 words or equivalent length)
- intro: 1-2 sentences (40-80 characters) describing what ties these notes together

Notes:
${notesBlock}

Respond with valid JSON only, in ${language}:
{"title": "...", "intro": "..."}`;
}

export interface PromptSet {
    description(title: string, content: string): string;
    mocNaming(notesBlock: string): string;
}

function fromLocale(loc: Locale): PromptSet {
    return {
        description: (title, content) => loc.llmPrompt(title, content),
        mocNaming: (notesBlock) => loc.mocClusterNamingPrompt(loc.languageLabel, notesBlock),
    };
}

/** Pick the prompts for the configured output language. "auto" (and
 *  "custom" with nothing usable typed) is the interface locale `ui`; a
 *  listed language swaps in that locale's whole prompt (036 D2). */
export function resolvePromptSet(
    pref: { aiOutputLanguage?: unknown; aiOutputLanguageCustom?: unknown },
    ui: Locale,
    table: Record<"en" | "zh-TW" | "zh-CN", Locale>,
): PromptSet {
    const lang = normalizeAiOutputLanguage(pref.aiOutputLanguage);
    if (lang === "custom") {
        const name = sanitizeCustomLanguage(pref.aiOutputLanguageCustom);
        if (name === "") return fromLocale(ui);
        return {
            description: (title, content) => customDescriptionPrompt(name, title, content),
            mocNaming: (notesBlock) => customMocNamingPrompt(name, notesBlock),
        };
    }
    if (lang === "auto") return fromLocale(ui);
    return fromLocale(table[lang]);
}
