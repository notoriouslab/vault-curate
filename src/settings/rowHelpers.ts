// Shared helpers for the setting-row factories: remote-endpoint warnings,
// the model dropdown, the long-running index actions and the stats panel.
// Split out of definitions.ts; the bodies are unchanged.

import type { ButtonComponent, Setting } from "obsidian";
import type { SettingsContext } from "./types";
import { fetchOllamaModels, formatLocalDateTime, isLoopbackHost } from "../utils";
import type { OllamaModel } from "../utils";
import type { ApiFormat } from "../types";
import { resolveLlmUrl } from "../utils/resolveLlmUrl";
import { keyText, resolveLlmApiKey } from "../utils/resolveLlmApiKey";
import { fillModelSelect } from "../ui/modelSelect";
import { t } from "../i18n";

export type Predicate = () => boolean;

/** Pause after the last keystroke in a server address before the model
 *  lists and the endpoint probe reload. */
export const SERVER_RELOAD_DELAY_MS = 500;

export function clearRemoteWarning(setting: Setting) {
    const existing = setting.settingEl.querySelector(".vault-curate-remote-warn");
    if (existing) existing.remove();
    const existingHttp = setting.settingEl.querySelector(".vault-curate-http-warn");
    if (existingHttp) existingHttp.remove();
}

/** `key` is the key this row's server receives, read by the caller at call
 *  time so a key typed later updates the warning. */
export function updateRemoteWarning(setting: Setting, url: string, key: string) {
    clearRemoteWarning(setting);
    try {
        const parsed = new URL(url);
        const isLocal = isLoopbackHost(parsed.hostname);
        if (!isLocal) {
            const warn = setting.settingEl.createDiv({ cls: "vault-curate-remote-warn" });
            warn.setText(t.remoteWarning);
        }
        if (parsed.protocol === "http:" && !isLocal && key) {
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
        /** Read live: a reload after a server edit must keep the model
         *  picked since the row was rendered. */
        current: () => string;
        onChange: (val: string) => Promise<void>;
        /** Whether the row is actually shown. On 1.13 a row whose `visible`
         *  predicate is false is still rendered (just CSS-hidden, spike S2),
         *  so a hidden row must not spend a network round-trip. */
        active: () => boolean;
    },
): () => void {
    const isLlm = o.kind === "llm";
    const initialValue = o.current();
    let disposed = false;
    let hint: HTMLElement | null = null;
    // Each load bumps this; an answer from an older server address is dropped.
    let generation = 0;
    // Assigned synchronously by addDropdown's callback.
    let select!: HTMLSelectElement;

    setting.addDropdown(drop => {
        drop.addOption("", "Loading...");
        if (initialValue) drop.addOption(initialValue, initialValue);
        drop.setValue(initialValue);
        drop.onChange(o.onChange);
        select = drop.selectEl;
    });

    // Hidden row: keep the current value selectable, skip the fetch. A later
    // ctx.refresh() re-renders the row once it becomes visible.
    if (!o.active()) return () => { /* nothing fetched, nothing to tear down */ };

    const load = () => {
        const gen = ++generation;
        const settings = o.ctx.plugin.settings;
        const currentValue = o.current();
        hint?.remove();
        hint = null;

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
            const models = await fetchOllamaModels(url, format, isLlm ? resolveLlmApiKey(settings) : keyText(settings.apiKey));
            const sel = select;
            if (disposed || gen !== generation || !sel) return;
            fill(sel, models, currentValue, format);
        })();
    };

    const fill = (sel: HTMLSelectElement, models: OllamaModel[], currentValue: string, format: ApiFormat) => {
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
    };

    load();
    // A server address edit reloads this list in place (no tab re-render).
    const unsubscribe = o.ctx.onServerChange(() => {
        if (disposed) return;
        // Drop the previous server's list before asking the new one.
        resetOptions(select, "Loading...", o.current());
        load();
    });

    return () => {
        disposed = true;
        unsubscribe();
        hint?.remove();
    };
}

/** Back to the pre-fetch shape: a placeholder plus the current model. */
function resetOptions(sel: HTMLSelectElement, placeholder: string, currentValue: string) {
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    sel.createEl("option", { value: "", text: placeholder });
    if (currentValue) sel.createEl("option", { value: currentValue, text: currentValue });
    sel.value = currentValue;
}

/** Run a long index action with the button parked on `busyText` meanwhile. */
export function runIndexAction(
    ctx: SettingsContext,
    button: ButtonComponent,
    idleText: string,
    busyText: string,
    run: () => Promise<void>,
) {
    button.setDisabled(true);
    button.setButtonText(busyText);
    void (async () => {
        // 031: restore the button even when the run fails, so a failed
        // rebuild does not strand it on "Indexing…".
        try {
            await run();
        } finally {
            button.setDisabled(false);
            button.setButtonText(idleText);
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
