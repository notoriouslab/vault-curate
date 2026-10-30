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
// (symbol noise wastes the LLM's context budget).
//
// 040 UPDATE: head 1200 + tail 800 left most of a long note unread and the
// model guessed the rest; the LLM now reads six evenly spread segments within
// a token budget, with URLs stripped (src/utils/llmSample.ts, 040 D1).

import { Notice, TFile } from "obsidian";
import type VaultSearchPlugin from "./main";
import { checkLLMReachable, requestLlmJson, stripFrontmatter } from "./utils";
import { resolveLlmUrl } from "./utils/resolveLlmUrl";
import { resolveLlmApiKey } from "./utils/resolveLlmApiKey";
import { stripDangerousInvisibles, trimDescription } from "./utils/sanitize";
import { parseGeneratedDescription } from "./utils/parseGeneratedDescription";
import { denoiseForEmbed } from "./indexer/denoise";
import { locales, t } from "./i18n";
import { resolvePromptSet } from "./utils/aiOutputLanguage";
import { sampleSpread, stripUrlsForLlm } from "./utils/llmSample";
import { llmFailureReason } from "./utils/llmError";

// A spread sample is about 1-5.3k tokens: prose stays near 2k, but random
// IDs, hashes and base64 the estimate cannot see through ran to 5.3k (040
// review). Ollama gets a 6144 context so its own default cannot silently cut
// the prompt, and big local models get 120 s (a 27B model took up to 123 s in
// the 040 pilot). 040 D2/D7.
const DESCRIPTION_NUM_CTX = 6144;
const DESCRIPTION_TIMEOUT_MS = 120_000;

// Re-exported for moc-generator.ts, which sanitizes its own LLM output.
export { stripDangerousInvisibles };


/**
 * LLM input sampling: denoise first (symbols waste context budget), drop
 * URLs, then six evenly spread segments within the token budget (040 D1).
 */
export function sampleForLlm(rawBody: string): string {
    return sampleSpread(stripUrlsForLlm(denoiseForEmbed(rawBody)));
}

/** A missing or null description counts as "" (what the batch records). */
function sameDescription(current: unknown, expected: string): boolean {
    return (current === undefined || current === null ? "" : current) === expected;
}

export class DescriptionGenerator {
    /** In-flight set keyed by file path — prevents duplicate LLM calls for the
     *  same note when a user double-clicks the sidebar button or simultaneously
     *  triggers the file-menu and palette command. */
    private inflight = new Set<string>();

    /** Why the latest LLM call failed, for the batch summary (issue #19). */
    private lastFailureReason = "";

    constructor(private plugin: VaultSearchPlugin) {}

    /** True when settings have a usable LLM endpoint + model configured. */
    hasLlmConfigured(): boolean {
        const { ollamaUrl, llmUrl, llmModel } = this.plugin.settings;
        return !!resolveLlmUrl(llmUrl, ollamaUrl) && !!llmModel;
    }

    /**
     * Pre-flight the curation endpoint with the protocol the user actually
     * configured — the same probe the Settings UI uses. The old bare-root
     * checkOllama() probe only works for Ollama (its root answers 200);
     * OpenAI-compatible servers like mlx_lm.server 404 on "/" while being
     * perfectly reachable at /v1/*, so curation refused a working endpoint.
     */
    private async llmReachable(): Promise<boolean> {
        const { ollamaUrl, llmUrl, apiFormat } = this.plugin.settings;
        const status = await checkLLMReachable({
            ollamaUrl: resolveLlmUrl(llmUrl, ollamaUrl),
            apiFormat,
            apiKey: resolveLlmApiKey(this.plugin.settings),
        });
        // Not Ollama-specific any more, and with the probe's reason (issue #19).
        if (!status.reachable) new Notice(t.llmNotReady(status.reason ?? "unknown"));
        return status.reachable;
    }

    /** Generate + write description for a single note. Returns true on success. */
    async generateForActiveNote(file: TFile): Promise<boolean> {
        if (!this.hasLlmConfigured()) {
            new Notice(t.descNoLlmConfigured);
            return false;
        }
        if (!(await this.llmReachable())) {
            return false;
        }
        return (await this.runOne(file)) === "ok";
    }

    /** Generate + write description for many notes (sequential). Returns
     *  the counts and which paths succeeded, so the caller can tell how many
     *  legacy-truncated descriptions were actually repaired (040 D6).
     *  `expected` maps a path to the description the batch picked it with
     *  ("" for none); a note whose description changed meanwhile is skipped
     *  so a hand edit made during a long batch is never overwritten. */
    async generateForFiles(
        files: TFile[],
        expected?: ReadonlyMap<string, string>,
    ): Promise<{ ok: number; failed: number; skipped: number; okPaths: Set<string> }> {
        const okPaths = new Set<string>();
        if (files.length === 0) return { ok: 0, failed: 0, skipped: 0, okPaths };
        if (!this.hasLlmConfigured()) {
            new Notice(t.descNoLlmConfigured);
            return { ok: 0, failed: 0, skipped: 0, okPaths };
        }
        if (!(await this.llmReachable())) {
            return { ok: 0, failed: 0, skipped: 0, okPaths };
        }

        const progress = new Notice(t.descGenerating(0, files.length), 0);
        this.lastFailureReason = "";
        let ok = 0;
        let failed = 0;
        let skipped = 0;
        for (let i = 0; i < files.length; i++) {
            const outcome = await this.runOne(files[i], /*silent=*/true, expected?.get(files[i].path));
            if (outcome === "ok") {
                ok++;
                okPaths.add(files[i].path);
            } else if (outcome === "skipped") skipped++;
            else failed++;
            progress.setMessage(t.descGenerating(i + 1, files.length));
            await new Promise(r => window.setTimeout(r, 0));
        }
        progress.hide();
        new Notice(t.descBatchDone(ok, failed, this.lastFailureReason), 8000);
        return { ok, failed, skipped, okPaths };
    }

    /** Core path: build prompt → call LLM → merge frontmatter. */
    /** "skipped": the description changed after the batch picked the note,
     *  so the user's edit was kept. */
    private async runOne(file: TFile, silent = false, expectedDesc?: string): Promise<"ok" | "failed" | "skipped"> {
        // Per-file in-flight guard — second invocation while LLM is running
        // returns immediately so the user can't accidentally fire two writes.
        // The Set entry is added INSIDE the try block (after the has-check)
        // so an early throw from cachedRead / extractTitle still hits the
        // finally cleanup — otherwise the path would leak and block all
        // future retries until plugin reload.
        if (this.inflight.has(file.path)) {
            if (!silent) new Notice(t.descGeneratingOne(file.basename), 3000);
            return "failed";
        }

        // Progress notice declared outside the try so finally can hide it
        // even if Notice construction throws before the inner try.
        const progress = silent ? null : new Notice(t.descGeneratingOne(file.basename), 0);

        try {
            // inflight.add lives INSIDE try so any throw from cachedRead /
            // extractTitle / metadata calls still hits the finally cleanup
            // and the path doesn't leak permanently in the Set.
            this.inflight.add(file.path);
            const { llmModel } = this.plugin.settings;
            const llmEndpoint = resolveLlmUrl(this.plugin.settings.llmUrl, this.plugin.settings.ollamaUrl);
            const title = this.extractTitle(file);
            const rawBody = stripFrontmatter(await this.plugin.app.vault.cachedRead(file));
            // 007 D6 / 040 D1: denoise, drop URLs, six spread segments.
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
                result = await this.callLLM(llmEndpoint, llmModel, title, body);
            } catch (e) {
                console.warn(`vault-curate: LLM failed for ${file.path}`, e);
                this.lastFailureReason = llmFailureReason(e);
                if (!silent) new Notice(t.descLlmFailed(file.basename, this.lastFailureReason));
                return "failed";
            }

            let description = (result.description ?? "").trim();
            // Defense: reject "description = title" (model echoing back the title).
            if (description && description.replace(/[_\-\s]/g, "") === title.replace(/[_\-\s]/g, "")) {
                try {
                    const retry = await this.callLLM(llmEndpoint, llmModel, title, body);
                    const retryDesc = (retry.description ?? "").trim();
                    if (retryDesc && retryDesc.replace(/[_\-\s]/g, "") !== title.replace(/[_\-\s]/g, "")) {
                        description = retryDesc;
                        if (retry.tags) result = { description: retryDesc, tags: retry.tags };
                    } else {
                        this.lastFailureReason = t.descReasonEchoTitle;
                        if (!silent) new Notice(t.descLlmFailed(file.basename, this.lastFailureReason));
                        return "failed";
                    }
                } catch (e) {
                    console.warn(`vault-curate: LLM retry failed for ${file.path}`, e);
                    this.lastFailureReason = llmFailureReason(e);
                    if (!silent) new Notice(t.descLlmFailed(file.basename, this.lastFailureReason));
                    return "failed";
                }
            }

            if (!description) {
                console.warn(`vault-curate: LLM returned no description for ${file.path}`);
                this.lastFailureReason = t.descReasonEmpty;
                if (!silent) new Notice(t.descLlmFailed(file.basename, this.lastFailureReason));
                return "failed";
            }

            const mergedTags = this.mergeTags(existingTags, result.tags);
            const finalDescription = trimDescription(description);

            // Compare before writing too: processFrontMatter re-serializes the
            // YAML even when the callback changes nothing (040 review).
            // Re-read the cache here: the LLM call above can take two minutes.
            const cacheNow = this.plugin.app.metadataCache.getFileCache(file);
            if (expectedDesc !== undefined && !sameDescription(cacheNow?.frontmatter?.description, expectedDesc)) {
                console.warn(`vault-curate: description of ${file.path} changed during the batch; kept it`);
                return "skipped";
            }
            let changedMeanwhile = false;
            try {
                await this.plugin.app.fileManager.processFrontMatter(file, (raw) => {
                    const fm = raw as Record<string, unknown>;
                    if (expectedDesc !== undefined) {
                        if (!sameDescription(fm.description, expectedDesc)) {
                            changedMeanwhile = true;
                            return;
                        }
                    }
                    fm.description = finalDescription;
                    // If tags came back as a non-array, non-string shape
                    // (number, object, etc.), don't overwrite — keep what's
                    // there so we don't silently destroy structured data.
                    if (mergedTags && !existingTagsUnknownShape) fm.tags = mergedTags;
                    if (!fm.title) fm.title = title;
                });
            } catch (e) {
                console.warn(`vault-curate: frontmatter merge failed for ${file.path}`, e);
                this.lastFailureReason = llmFailureReason(e);
                if (!silent) new Notice(t.descLlmFailed(file.basename, this.lastFailureReason));
                return "failed";
            }
            if (changedMeanwhile) {
                console.warn(`vault-curate: description of ${file.path} changed during the batch; kept it`);
                return "skipped";
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
            return "ok";
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
                apiKey: resolveLlmApiKey(this.plugin.settings),
            },
            resolvePromptSet(this.plugin.settings, t, locales).description(title, content),
            (raw) => this.parseGeneratedJSON(raw),
            { timeoutMs: DESCRIPTION_TIMEOUT_MS, numCtx: DESCRIPTION_NUM_CTX },
        );
    }

    private parseGeneratedJSON(raw: string): { description: string; tags?: string[] } {
        return parseGeneratedDescription(raw);
    }
}
