// Description Generator — selection-based (Phase 6 / 004 rebrand)
//
// Phase 6 demotion (design.md D7): the v0.3.x "scan whole vault → write
// preview report → apply" pipeline is removed. Description is now an opt-in
// per-note action — triggered from commands, the file-menu, or the Discover
// sidebar.
//
// 007 UPDATE: descriptions are load-bearing again — they get their own
// embedding and blend into the note ranking vector (007 D4/D5). Output
// quality therefore matters: sampling runs through denoiseForEmbed first
// (symbol noise wastes the LLM's context budget) and takes head+tail
// (template-heavy notes put the personal content at the end; head-only
// sampling made the LLM describe the template — 007 D6).

import { Notice, TFile } from "obsidian";
import type VaultSearchPlugin from "./main";
import { checkLLMReachable, requestLlmJson, stripFrontmatter } from "./utils";
import { coerceTagList } from "./utils/coerceTagList";
import { denoiseForEmbed } from "./indexer/denoise";
import { t } from "./i18n";

// LLM sampling budget (007 D6): total stays 2000 chars, split head 1200 +
// tail 800 when the (denoised) body is longer — see sampleForLlm().
const BODY_CAP = 2000;
const HEAD_CAP = 1200;
const TAIL_CAP = 800;
const DESCRIPTION_LENGTH_CAP = 500;
const TAG_LENGTH_CAP = 64;

/**
 * Match every control / line-break code point that YAML or downstream
 * UI rendering might choke on, BUT preserve common whitespace
 * (\x09 tab, \x0a LF, \x0d CR) so multi-line markdown descriptions
 * survive intact. Covers:
 *   C0       (\x00-\x08, \x0b-\x0c, \x0e-\x1f — NUL etc., minus \t \n \r)
 *   DEL      (\x7f)
 *   C1       (\x80-\x9f - rarely seen but YAML 1.2 line breaks)
 *   LS / PS  (\u2028 / \u2029 - line/paragraph separator)
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
// combining marks grouped together. Built via RegExp + escape strings so
// the source file stays plain ASCII (Edit/Write tools decode raw \uXXXX in
// regex literals, which corrupted earlier versions).
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
function safeSlice(text: string, max: number): string {
    if (max <= 0) return "";
    if (text.length <= max) return text;
    let cut = max;
    // If we landed on a high surrogate, back off one code unit.
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
    return text.slice(0, cut);
}

/** Tail counterpart of safeSlice: last `max` code units, surrogate-safe. */
function safeTail(text: string, max: number): string {
    if (max <= 0) return "";
    if (text.length <= max) return text;
    let start = text.length - max;
    // If we landed on a low surrogate, skip forward one code unit.
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) start++;
    return text.slice(start);
}

/**
 * LLM input sampling (007 D6): denoise first (symbols waste context budget),
 * then head 1200 + tail 800 when longer than 2000 — template-heavy notes
 * keep their personal content near the end, and head-only sampling used to
 * make the LLM describe the template instead of the person/topic.
 */
export function sampleForLlm(rawBody: string): string {
    const clean = denoiseForEmbed(rawBody);
    if (clean.length <= BODY_CAP) return clean;
    return `${safeSlice(clean, HEAD_CAP)}\n…\n${safeTail(clean, TAIL_CAP)}`;
}

export class DescriptionGenerator {
    /** In-flight set keyed by file path — prevents duplicate LLM calls for the
     *  same note when a user double-clicks the sidebar button or simultaneously
     *  triggers the file-menu and palette command. */
    private inflight = new Set<string>();

    constructor(private plugin: VaultSearchPlugin) {}

    /** True when settings have a usable LLM endpoint + model configured. */
    hasLlmConfigured(): boolean {
        const { ollamaUrl, llmModel } = this.plugin.settings;
        return !!ollamaUrl && !!llmModel;
    }

    /**
     * Pre-flight the curation endpoint with the protocol the user actually
     * configured — the same probe the Settings UI uses. The old bare-root
     * checkOllama() probe only works for Ollama (its root answers 200);
     * OpenAI-compatible servers like mlx_lm.server 404 on "/" while being
     * perfectly reachable at /v1/*, so curation refused a working endpoint.
     */
    private async llmReachable(): Promise<boolean> {
        const { ollamaUrl, apiFormat, apiKey } = this.plugin.settings;
        return (await checkLLMReachable({ ollamaUrl, apiFormat, apiKey: apiKey ?? "" })).reachable;
    }

    /** Generate + write description for a single note. Returns true on success. */
    async generateForActiveNote(file: TFile): Promise<boolean> {
        if (!this.hasLlmConfigured()) {
            new Notice(t.descNoLlmConfigured);
            return false;
        }
        if (!(await this.llmReachable())) {
            new Notice(t.ollamaNotReady);
            return false;
        }
        return this.runOne(file);
    }

    /** Generate + write description for many notes (sequential). */
    async generateForFiles(files: TFile[]): Promise<void> {
        if (files.length === 0) return;
        if (!this.hasLlmConfigured()) {
            new Notice(t.descNoLlmConfigured);
            return;
        }
        if (!(await this.llmReachable())) {
            new Notice(t.ollamaNotReady);
            return;
        }

        const progress = new Notice(t.descGenerating(0, files.length), 0);
        let ok = 0;
        let failed = 0;
        for (let i = 0; i < files.length; i++) {
            const success = await this.runOne(files[i], /*silent=*/true);
            if (success) ok++;
            else failed++;
            progress.setMessage(t.descGenerating(i + 1, files.length));
            await new Promise(r => window.setTimeout(r, 0));
        }
        progress.hide();
        new Notice(t.descBatchDone(ok, failed), 8000);
    }

    /** Core path: build prompt → call LLM → merge frontmatter. */
    private async runOne(file: TFile, silent = false): Promise<boolean> {
        // Per-file in-flight guard — second invocation while LLM is running
        // returns immediately so the user can't accidentally fire two writes.
        // The Set entry is added INSIDE the try block (after the has-check)
        // so an early throw from cachedRead / extractTitle still hits the
        // finally cleanup — otherwise the path would leak and block all
        // future retries until plugin reload.
        if (this.inflight.has(file.path)) {
            if (!silent) new Notice(t.descGeneratingOne(file.basename), 3000);
            return false;
        }

        // Progress notice declared outside the try so finally can hide it
        // even if Notice construction throws before the inner try.
        const progress = silent ? null : new Notice(t.descGeneratingOne(file.basename), 0);

        try {
            // inflight.add lives INSIDE try so any throw from cachedRead /
            // extractTitle / metadata calls still hits the finally cleanup
            // and the path doesn't leak permanently in the Set.
            this.inflight.add(file.path);
            const { ollamaUrl, llmModel } = this.plugin.settings;
            const title = this.extractTitle(file);
            const rawBody = stripFrontmatter(await this.plugin.app.vault.cachedRead(file));
            // 007 D6: denoise + head/tail sampling (surrogate-safe slices).
            const body = sampleForLlm(rawBody);
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const existingTagsRaw = cache?.frontmatter?.tags as unknown;
            const existingTags: string[] = Array.isArray(existingTagsRaw)
                ? existingTagsRaw.map(String)
                : typeof existingTagsRaw === "string"
                    ? existingTagsRaw.split(",").map(s => s.trim()).filter(Boolean)
                    : [];
            const existingTagsUnknownShape = existingTagsRaw !== undefined
                && existingTagsRaw !== null
                && !Array.isArray(existingTagsRaw)
                && typeof existingTagsRaw !== "string";

            let result: { description: string; tags?: string[] };
            try {
                result = await this.callLLM(ollamaUrl, llmModel, title, body);
            } catch (e) {
                console.warn(`vault-curate: LLM failed for ${file.path}`, e);
                if (!silent) new Notice(t.descLlmFailed(file.basename));
                return false;
            }

            let description = (result.description ?? "").trim();
            // Defense: reject "description = title" (model echoing back the title).
            if (description && description.replace(/[_\-\s]/g, "") === title.replace(/[_\-\s]/g, "")) {
                try {
                    const retry = await this.callLLM(ollamaUrl, llmModel, title, body);
                    const retryDesc = (retry.description ?? "").trim();
                    if (retryDesc && retryDesc.replace(/[_\-\s]/g, "") !== title.replace(/[_\-\s]/g, "")) {
                        description = retryDesc;
                        if (retry.tags) result = { description: retryDesc, tags: retry.tags };
                    } else {
                        if (!silent) new Notice(t.descLlmFailed(file.basename));
                        return false;
                    }
                } catch (e) {
                    console.warn(`vault-curate: LLM retry failed for ${file.path}`, e);
                    if (!silent) new Notice(t.descLlmFailed(file.basename));
                    return false;
                }
            }

            if (!description) {
                if (!silent) new Notice(t.descLlmFailed(file.basename));
                return false;
            }

            const mergedTags = this.mergeTags(existingTags, result.tags);
            const finalDescription = safeSlice(description, DESCRIPTION_LENGTH_CAP);

            try {
                await this.plugin.app.fileManager.processFrontMatter(file, (raw) => {
                    const fm = raw as Record<string, unknown>;
                    fm.description = finalDescription;
                    // If tags came back as a non-array, non-string shape
                    // (number, object, etc.), don't overwrite — keep what's
                    // there so we don't silently destroy structured data.
                    if (mergedTags && !existingTagsUnknownShape) fm.tags = mergedTags;
                    if (!fm.title) fm.title = title;
                });
            } catch (e) {
                console.warn(`vault-curate: frontmatter merge failed for ${file.path}`, e);
                if (!silent) new Notice(t.descLlmFailed(file.basename));
                return false;
            }

            // 010 D6: this write is the plugin's doing, not a user judgment
            // action — record it so the mtime bump doesn't re-heat the note.
            // Date.now() right after the awaited write is within the ledger's
            // ±2s tolerance of the on-disk mtime by construction; TFile.stat
            // may still hold the PRE-write value here (vault event loop lag),
            // and recording that stale mtime would miss the exemption window
            // and let a batch run whitewash every Cold note (review W4).
            this.plugin.recordSelfWrite(file.path, Date.now());

            if (!silent) new Notice(t.descGeneratedOne(file.basename));
            return true;
        } finally {
            progress?.hide();
            this.inflight.delete(file.path);
        }
    }

    private extractTitle(file: TFile): string {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        let raw = String(
            cache?.frontmatter?.title
            ?? cache?.headings?.find(h => h.level === 1)?.heading
            ?? file.basename,
        );
        // Strip wikilink syntax wherever it appears — `[[foo]]`, `[[foo|bar]]`,
        // and embedded forms like `[[foo]] suffix`. Earlier versions only
        // stripped if the *whole* title was a wikilink, missing prefix/suffix cases.
        raw = raw.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
            const text = String(alias ?? target);
            const slash = text.lastIndexOf("/");
            return slash >= 0 ? text.slice(slash + 1) : text;
        });
        // Defang YAML-breaking characters before we ever consider writing this
        // into frontmatter (processFrontMatter quotes most things, but explicit
        // sanitisation here keeps the round-trip predictable).
        raw = stripDangerousInvisibles(raw, " ").replace(/---/g, "—");
        return raw.trim();
    }

    private mergeTags(existing: string[], generated: string[] | undefined): string[] | null {
        if (!generated || generated.length === 0) return null;
        const normalized = new Set(existing.map(s => s.toLowerCase().replace(/^#/, "")));
        const added = generated.filter(s => !normalized.has(s.toLowerCase()));
        if (added.length === 0) return null;
        return [...existing, ...added];
    }

    private async callLLM(
        url: string,
        model: string,
        title: string,
        content: string,
    ): Promise<{ description: string; tags?: string[] }> {
        return requestLlmJson(
            {
                ollamaUrl: url,
                llmModel: model,
                apiFormat: this.plugin.settings.apiFormat,
                apiKey: this.plugin.settings.apiKey,
            },
            t.llmPrompt(title, content),
            (raw) => this.parseGeneratedJSON(raw),
        );
    }

    private parseGeneratedJSON(raw: string): { description: string; tags?: string[] } {
        const tryParse = (text: string): { description: string; tags?: string[] } | null => {
            try {
                const parsed: unknown = JSON.parse(text);
                if (typeof parsed !== "object" || parsed === null) return null;
                const obj = parsed as { description?: unknown; summary?: unknown; tags?: unknown };
                const descRaw = typeof obj.description === "string"
                    ? obj.description
                    : typeof obj.summary === "string"
                        ? obj.summary
                        : "";
                // Strip control + C1 + line-separator code points before any
                // further use — a poisoned LLM response could otherwise smuggle
                // ANSI escapes, YAML-confusing line breaks, or invisible chars
                // into frontmatter.
                const desc = safeSlice(stripDangerousInvisibles(descRaw, " "), DESCRIPTION_LENGTH_CAP);
                const cleanedTags = coerceTagList(obj.tags)
                    .map((s) => String(s))
                    .map((s) => stripDangerousInvisibles(s).replace(/\s+/g, "_"))
                    .map((s) => safeSlice(s, TAG_LENGTH_CAP))
                    .filter((s) => s !== "..." && s !== "…" && s.length > 0);
                const tags = cleanedTags.length > 0 ? cleanedTags : undefined;
                return { description: desc, tags };
            } catch { return null; }
        };

        return tryParse(raw)
            ?? tryParse(raw.replace(/```json\n?|\n?```/g, "").trim())
            ?? { description: safeSlice(raw, 200) };
    }
}
