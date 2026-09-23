// Shared helpers for the setting-row factories: remote-endpoint warnings,
// the model dropdown, the long-running index actions and the stats panel.
// Split out of definitions.ts; the bodies are unchanged.

import type { Setting } from "obsidian";
import type { SettingsContext } from "./types";
import { fetchOllamaModels, formatLocalDateTime, isLoopbackHost } from "../utils";
import { resolveLlmUrl } from "../utils/resolveLlmUrl";
import { fillModelSelect } from "../ui/modelSelect";
import { t } from "../i18n";

export type Predicate = () => boolean;

export function clearRemoteWarning(setting: Setting) {
    const existing = setting.settingEl.querySelector(".vault-curate-remote-warn");
    if (existing) existing.remove();
    const existingHttp = setting.settingEl.querySelector(".vault-curate-http-warn");
    if (existingHttp) existingHttp.remove();
}

export function updateRemoteWarning(ctx: SettingsContext, setting: Setting, url: string) {
    clearRemoteWarning(setting);
    try {
        const parsed = new URL(url);
        const isLocal = isLoopbackHost(parsed.hostname);
        if (!isLocal) {
            const warn = setting.settingEl.createDiv({ cls: "vault-curate-remote-warn" });
            warn.setText(t.remoteWarning);
        }
        if (parsed.protocol === "http:" && !isLocal && ctx.plugin.settings.apiKey) {
            const warn = setting.settingEl.createDiv({ cls: "vault-curate-http-warn vault-curate-remote-warn" });
            warn.setText(t.httpApiKeyWarning);
        }
    } catch { /* invalid URL, ignore */ }
}

/**
 * Fill a model dropdown from the endpoint that this row's path actually
 * talks to. Replaces the old tab-wide loadModelOptions() sweep: each row
 * fetches for itself, so the row owns both its hint line and its teardown.
 */
export function renderModelDropdown(
    setting: Setting,
    o: {
        ctx: SettingsContext;
        kind: "embedding" | "llm";
        current: string;
        onChange: (val: string) => Promise<void>;
    },
): () => void {
    const settings = o.ctx.plugin.settings;
    const isLlm = o.kind === "llm";
    const currentValue = o.current;
    let disposed = false;
    let hint: HTMLElement | null = null;
    // Assigned synchronously by addDropdown's callback.
    let select!: HTMLSelectElement;

    setting.addDropdown(drop => {
        drop.addOption("", "Loading...");
        if (currentValue) drop.addOption(currentValue, currentValue);
        drop.setValue(currentValue);
        drop.onChange(o.onChange);
        select = drop.selectEl;
    });

    // 023: the LLM dropdown lists what its own (possibly separate) server
    // offers; the embedding dropdown always lists the main server's models.
    // 024: each list speaks its own path's protocol — the embedding list
    // derives it from embeddingProvider (apiFormat is LLM-only and hidden
    // while AI curation is off), the LLM list uses apiFormat.
    const embFormat = settings.embeddingProvider !== "wasm"
        ? (settings.embeddingProvider === "openai-compatible" ? "openai" : "ollama")
        : settings.apiFormat;
    const url = isLlm ? resolveLlmUrl(settings.llmUrl, settings.ollamaUrl) : settings.ollamaUrl;
    const format = isLlm ? settings.apiFormat : embFormat;

    void (async () => {
        const models = await fetchOllamaModels(url, format);
        const sel = select;
        if (disposed || !sel) return;

        // 031: an empty list is itself a finding — the dropdown must say the
        // server could not be reached instead of sitting on "Loading...".
        if (models.length === 0) {
            const placeholder = sel.querySelector('option[value=""]');
            if (placeholder) placeholder.textContent = t.modelListUnavailable;
            sel.value = currentValue;
            return;
        }

        // 031: list every model the server reports, grouped by kind, with
        // this dropdown's kind first. Filtering by kind used to hide
        // embedding models the name heuristic did not recognise.
        const { missing } = fillModelSelect(
            sel,
            models,
            isLlm ? "other" : "embedding",
            currentValue,
            {
                placeholder: t.selectModel,
                embeddingGroup: t.modelGroupEmbedding,
                otherGroup: isLlm ? t.modelGroupLlm : t.modelGroupOther,
                notInstalled: t.modelNotInstalled,
            },
        );

        if (missing) {
            // Only Ollama has a `pull` command to point at.
            hint = setting.descEl.createDiv({
                cls: "vault-curate-note vault-curate-model-hint",
                text: format === "ollama"
                    ? t.modelNotInstalledHintOllama(currentValue)
                    : t.modelNotListedHint,
            });
        }
    })();

    return () => {
        disposed = true;
        hint?.remove();
    };
}

/** The element an `action` receives is the row (1.13) or the button (legacy). */
export function actionButtonEl(el: HTMLElement): HTMLButtonElement | null {
    if (el.tagName === "BUTTON") return el as HTMLButtonElement;
    return el.querySelector("button");
}

/** Run a long index action with the button parked on `busyText` meanwhile. */
export function runIndexAction(
    ctx: SettingsContext,
    el: HTMLElement,
    busyText: string,
    run: () => Promise<void>,
) {
    const button = actionButtonEl(el);
    const idleText = button?.textContent ?? "";
    if (button) {
        button.disabled = true;
        button.textContent = busyText;
    }
    void (async () => {
        // 031: restore the button even when the run fails, so a failed
        // rebuild does not strand it on "Indexing…".
        try {
            await run();
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = idleText;
            }
            ctx.refresh();
        }
    })();
}

/** (Re)fill the index-stats panel. Tier derives at query time (010 D5), so
 *  this panel must track the hotDays setting to stay consistent with
 *  Discover (same-state-multiple-surfaces). */
export function renderStatsInto(ctx: SettingsContext, stats: HTMLElement) {
    const store = ctx.plugin.store;
    if (!store) return;
    stats.empty();
    const allBody = store.getAllBodyVecs();
    let hotCount = 0;
    let coldCount = 0;
    const tierResolver = ctx.plugin.tierResolver();
    for (const path of allBody.keys()) {
        if (!store.getNote(path)) continue;
        if (tierResolver(path) === "cold") coldCount++;
        else hotCount++;
    }
    stats.createEl("p", { text: `${t.totalNotes}: ${allBody.size}` });
    stats.createEl("p", { text: `${t.hot}: ${hotCount} / ${t.cold}: ${coldCount}` });
    const modelId = store.getMeta("embedding_model_id") ?? "—";
    const dim = store.getMeta("embedding_dim") ?? "—";
    stats.createEl("p", { text: `${t.model}: ${modelId}` });
    stats.createEl("p", { text: `${t.dimensions}: ${dim}` });
    const lastIndexedRaw = store.getMeta("last_indexed_at");
    if (lastIndexedRaw) {
        const d = new Date(lastIndexedRaw);
        const localTime = isNaN(d.getTime()) ? lastIndexedRaw : formatLocalDateTime(d);
        stats.createEl("p", { text: `${t.lastIndexed}: ${localTime}` });
    }
}
