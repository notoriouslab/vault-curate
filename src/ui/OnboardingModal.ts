// Onboarding modal (Phase 8 / 004 rebrand, D9.3).
//
// Shown on first plugin launch when neither `last_indexed_at` nor
// `onboarding_dismissed` meta is set. Picks the embedding provider, gates
// AI curation behind explicit opt-in, and kicks off the initial scanVault
// when the user clicks "Index now". A "Skip for now" path records
// dismissal so the modal stops re-appearing on every launch.

import { App, Modal, Notice, requestUrl } from "obsidian";
import type VaultSearchPlugin from "../main";
import type { ApiFormat, EmbeddingProviderType } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { validateServerUrl, isLoopbackHost, fetchOllamaModels } from "../utils";
import { fillModelSelect } from "./modelSelect";
import { t } from "../i18n";

type AICurationChoice = "yes" | "no";

export interface OnboardingChoice {
    provider: EmbeddingProviderType;
    aiCuration: AICurationChoice;
    indexNow: boolean;
    /** Populated only when provider === "openai-compatible". */
    openaiUrl?: string;
    openaiModel?: string;
    openaiKey?: string;
    /** Populated only when provider === "ollama". */
    ollamaModel?: string;
    /** True when the user dismissed with "Skip for now" (vs. picked a provider). */
    dismissed: boolean;
}

export class OnboardingModal extends Modal {
    private chosenProvider: EmbeddingProviderType = "wasm";
    private chosenAICuration: AICurationChoice = "no";
    private ollamaReachable = false;
    private openaiUrl = "http://localhost:11434/v1";
    private openaiModel = "";
    private openaiKey = "";
    private ollamaModel = "";
    private ollamaModelSelect?: HTMLSelectElement;
    private ollamaModelField?: HTMLDivElement;
    private endpointBody!: HTMLDivElement;
    private statusEls = {} as Record<EmbeddingProviderType, HTMLDivElement | undefined>;
    private indexBtn!: HTMLButtonElement;
    /** Closed flag — guards async setText() against detached DOM after Esc/X. */
    private isClosed = false;
    /** True once a Close/Skip/Index decision was made — prevents duplicate onComplete. */
    private decided = false;
    /** One-shot guard so repeated Test-connection clicks don't stack Notices. */
    private httpWarningShown = false;

    constructor(
        app: App,
        private plugin: VaultSearchPlugin,
        private onComplete: (choice: OnboardingChoice) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(t.onboardingTitle);
        this.contentEl.createEl("p", { text: t.onboardingIntro, cls: "vault-curate-onboarding-intro" });

        this.contentEl.createEl("h4", { text: t.onboardingProviderHeading });
        const providerGroup = this.contentEl.createDiv({ cls: "vault-curate-onboarding-providers" });
        this.buildProviderOption(providerGroup, "wasm", t.embeddingProviderBuiltin, t.builtinModelNote);
        const ollamaRow = this.buildProviderOption(providerGroup, "ollama", t.embeddingProviderOllama, "");
        this.buildOllamaModelField(ollamaRow);
        this.buildProviderOption(providerGroup, "openai-compatible", t.embeddingProviderOpenAI, "");

        this.endpointBody = this.contentEl.createDiv({ cls: "vault-curate-onboarding-endpoint vault-curate-hidden" });
        this.buildOpenAIFields(this.endpointBody);

        this.contentEl.createEl("h4", { text: t.onboardingAIHeading });
        const aiGroup = this.contentEl.createDiv({ cls: "vault-curate-onboarding-ai" });
        this.buildAIOption(aiGroup, "no", t.onboardingAINo);
        this.buildAIOption(aiGroup, "yes", t.onboardingAIYes);

        const btnRow = this.contentEl.createDiv({ cls: "vault-curate-modal-btnrow" });
        const skipBtn = btnRow.createEl("button", { text: t.onboardingLater });
        skipBtn.addEventListener("click", () => this.complete(false, true));

        this.indexBtn = btnRow.createEl("button", { text: t.onboardingIndexNow });
        this.indexBtn.addClass("mod-cta");
        this.indexBtn.addEventListener("click", () => this.handleIndexClick());

        void this.detectOllama();
    }

    onClose(): void {
        this.isClosed = true;
        // If the user closed via Esc / X / backdrop without picking, treat as
        // a dismissal so we don't bounce the modal on every launch.
        if (!this.decided) this.complete(false, true);
        this.contentEl.empty();
    }

    private complete(indexNow: boolean, dismissed: boolean) {
        if (this.decided) return;
        this.decided = true;
        this.onComplete({
            provider: this.chosenProvider,
            aiCuration: this.chosenAICuration,
            indexNow,
            openaiUrl: this.chosenProvider === "openai-compatible" ? this.openaiUrl : undefined,
            openaiModel: this.chosenProvider === "openai-compatible" ? this.openaiModel : undefined,
            openaiKey: this.chosenProvider === "openai-compatible" ? this.openaiKey : undefined,
            ollamaModel: this.chosenProvider === "ollama" ? this.ollamaModel : undefined,
            dismissed,
        });
        if (!this.isClosed) this.close();
    }

    private handleIndexClick() {
        // Validate provider preconditions before kicking off a rebuild.
        // AI curation needs an LLM endpoint, NOT a specific embedding provider.
        // wasm + AI yes is valid when Ollama is reachable (LLM defaults to
        // settings.ollamaUrl). openai-compatible embedding doubles as LLM
        // endpoint, so it always satisfies the LLM requirement.
        if (
            this.chosenAICuration === "yes" &&
            this.chosenProvider === "wasm" &&
            !this.ollamaReachable
        ) {
            new Notice(t.onboardingAIRequiresLlm, 8000);
            return;
        }
        if (this.chosenProvider === "ollama" && !this.ollamaReachable) {
            new Notice(t.onboardingOllamaNotDetected, 8000);
            return;
        }
        if (this.chosenProvider === "ollama" && !this.ollamaModel) {
            new Notice(t.onboardingNoEmbeddingModel(DEFAULT_SETTINGS.ollamaModel), 8000);
            return;
        }
        if (this.chosenProvider === "openai-compatible") {
            if (!this.openaiUrl || !this.openaiModel) {
                new Notice(t.onboardingTestFail, 6000);
                return;
            }
            try {
                validateServerUrl(this.openaiUrl);
            } catch (err) {
                new Notice(err instanceof Error ? err.message : String(err), 8000);
                return;
            }
        }
        this.complete(true, false);
    }

    private buildProviderOption(
        parent: HTMLElement,
        value: EmbeddingProviderType,
        label: string,
        note: string,
    ): HTMLDivElement {
        const row = parent.createDiv({ cls: "vault-curate-onboarding-option" });
        const radio = row.createEl("input", { type: "radio", attr: { name: "vault-curate-provider", value } });
        if (value === this.chosenProvider) radio.checked = true;
        row.createEl("label", { text: label });
        const status = row.createDiv({ cls: "vault-curate-onboarding-status" });
        this.statusEls[value] = status;
        if (note) {
            row.createDiv({ text: note, cls: "vault-curate-onboarding-note" });
        }
        radio.addEventListener("change", () => {
            if (radio.checked) {
                this.chosenProvider = value;
                this.endpointBody.toggleClass("vault-curate-hidden", value !== "openai-compatible");
            }
        });
        return row;
    }

    /** Embedding-model picker for the Ollama row — hidden until the probe
     *  comes back with a model list. */
    private buildOllamaModelField(row: HTMLDivElement) {
        const field = row.createDiv({ cls: "vault-curate-onboarding-field vault-curate-hidden" });
        field.createEl("label", { text: t.embeddingModel });
        const select = field.createEl("select");
        select.addEventListener("change", () => { this.ollamaModel = select.value; });
        this.ollamaModelField = field;
        this.ollamaModelSelect = select;
    }

    private buildAIOption(parent: HTMLElement, value: AICurationChoice, label: string) {
        const row = parent.createDiv({ cls: "vault-curate-onboarding-option" });
        const radio = row.createEl("input", { type: "radio", attr: { name: "vault-curate-ai", value } });
        if (value === this.chosenAICuration) radio.checked = true;
        row.createEl("label", { text: label });
        radio.addEventListener("change", () => {
            if (radio.checked) this.chosenAICuration = value;
        });
    }

    private buildOpenAIFields(parent: HTMLElement) {
        const urlInput = this.makeLabeledInput(parent, t.onboardingOpenaiEndpoint, this.openaiUrl);
        urlInput.addEventListener("input", () => { this.openaiUrl = urlInput.value.trim(); });

        const modelInput = this.makeLabeledInput(parent, t.onboardingOpenaiModel, this.openaiModel);
        modelInput.addEventListener("input", () => { this.openaiModel = modelInput.value.trim(); });

        const keyInput = this.makeLabeledInput(parent, t.apiKeyLabel, this.openaiKey);
        keyInput.type = "password";
        keyInput.addEventListener("input", () => { this.openaiKey = keyInput.value.trim(); });

        const testRow = parent.createDiv({ cls: "vault-curate-onboarding-test" });
        const testBtn = testRow.createEl("button", { text: t.onboardingTestConnection });
        const testStatus = testRow.createSpan({ cls: "vault-curate-onboarding-test-status" });
        testBtn.addEventListener("click", () => {
            void (async () => {
                if (this.isClosed) return;
                testStatus.setText("...");
                const ok = await this.testOpenAI(this.openaiUrl, this.openaiKey);
                if (this.isClosed) return;
                testStatus.setText(ok ? t.onboardingTestOk : t.onboardingTestFail);
            })();
        });
    }

    private makeLabeledInput(parent: HTMLElement, label: string, initial: string): HTMLInputElement {
        const row = parent.createDiv({ cls: "vault-curate-onboarding-field" });
        row.createEl("label", { text: label });
        const input = row.createEl("input", { type: "text" });
        input.value = initial;
        return input;
    }

    /**
     * Probe the user's configured Ollama endpoint (not hardcoded localhost).
     * Uses Obsidian's `requestUrl` for consistency with the rest of the plugin
     * — `fetch()` has been observed to trip private-network-access policies
     * in Chromium versions shipped with Obsidian Electron.
     *
     * `requestUrl` has no built-in timeout; we race it against a 3 s timer
     * so a black-holed endpoint doesn't leave the status indicator stuck
     * on "...".
     */
    /**
     * Probe the configured Ollama endpoint on modal open. We only auto-probe
     * loopback hosts — a pre-seeded `settings.ollamaUrl` pointing at an
     * attacker domain would otherwise trigger an automatic outbound GET
     * the moment the user opens the modal (Settings → Re-run onboarding
     * is a single click). For non-loopback URLs we leave the status blank;
     * the user can re-run onboarding after pointing settings at a real
     * local Ollama.
     */
    private async detectOllama() {
        const status = this.statusEls.ollama;
        const url = this.plugin.settings.ollamaUrl || "http://localhost:11434";
        let isLocal = false;
        try {
            isLocal = isLoopbackHost(new URL(url).hostname);
        } catch { /* invalid URL → treat as non-local, skip auto-probe */ }
        if (!isLocal) {
            this.ollamaReachable = false;
            return;
        }
        try {
            const target = `${url.replace(/\/$/, "")}/api/tags`;
            const resp = await withTimeout(
                requestUrl({ url: target, method: "GET", throw: false }),
                3000,
            );
            const ok = resp.status >= 200 && resp.status < 300;
            this.ollamaReachable = ok;
            if (this.isClosed) return;
            status?.setText(ok ? t.onboardingOllamaDetected : t.onboardingOllamaNotDetected);
            if (ok) await this.loadOllamaModels(url);
        } catch {
            this.ollamaReachable = false;
            if (this.isClosed || !status) return;
            status.setText(t.onboardingOllamaNotDetected);
        }
    }

    /**
     * Fill the Ollama embedding-model picker from the live server. An empty
     * embedding group is the actionable case (issue #14): the user has Ollama
     * but no embedding model, so say which command installs one.
     */
    private async loadOllamaModels(url: string) {
        const select = this.ollamaModelSelect;
        if (!select) return;
        const models = await fetchOllamaModels(url, "ollama");
        if (this.isClosed) return;
        fillModelSelect(select, models, "embedding", "", {
            placeholder: t.selectModel,
            embeddingGroup: t.modelGroupEmbedding,
            otherGroup: t.modelGroupOther,
            notInstalled: t.modelNotInstalled,
        });
        this.ollamaModelField?.removeClass("vault-curate-hidden");
        const firstEmbedding = models.find((m) => m.kind === "embedding");
        if (firstEmbedding) {
            this.ollamaModel = firstEmbedding.name;
            select.value = firstEmbedding.name;
        } else {
            this.statusEls.ollama?.setText(
                t.onboardingNoEmbeddingModel(DEFAULT_SETTINGS.ollamaModel),
            );
        }
    }

    /**
     * Validate and probe an OpenAI-compatible endpoint. Refuses non-http(s)
     * schemes; warns once per modal when sending a Bearer token over
     * plaintext HTTP to a non-loopback host (avoids stacking Notices on
     * repeated Test-connection clicks).
     */
    private async testOpenAI(url: string, key: string): Promise<boolean> {
        if (!url) return false;
        try {
            validateServerUrl(url);
        } catch {
            return false;
        }
        try {
            const parsed = new URL(url);
            const isLoopback = isLoopbackHost(parsed.hostname);
            if (key && parsed.protocol === "http:" && !isLoopback && !this.httpWarningShown) {
                this.httpWarningShown = true;
                new Notice(t.httpApiKeyWarning, 10000);
            }
            const base = url.replace(/\/$/, "");
            const target = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
            const resp = await withTimeout(
                requestUrl({
                    url: target,
                    method: "GET",
                    headers: key ? { Authorization: `Bearer ${key}` } : {},
                    throw: false,
                }),
                3000,
            );
            return resp.status >= 200 && resp.status < 300;
        } catch {
            return false;
        }
    }
}

/**
 * Race a promise against a timeout. Rejects with a generic timeout error
 * after `ms` milliseconds. Used so an unreachable endpoint can't hang
 * the modal forever — `requestUrl` itself has no timeout knob.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: number | undefined;
    // Attach a no-op catch so a late rejection from the underlying promise
    // (arriving AFTER the timeout already won the race) doesn't surface as
    // an unhandled-rejection warning in the console.
    void promise.catch(() => { /* late rejection swallowed by design */ });
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    });
    return Promise.race([
        promise.finally(() => { if (timer) window.clearTimeout(timer); }),
        timeout,
    ]);
}

/**
 * Apply the user's onboarding choices to plugin settings, then kick off
 * the initial rebuild when requested. The store gets an
 * `onboarding_dismissed` marker either way so the modal won't pop again
 * on every layout-ready.
 */
export async function applyOnboardingChoice(
    plugin: VaultSearchPlugin,
    choice: OnboardingChoice,
): Promise<void> {
    plugin.settings.embeddingProvider = choice.provider;
    plugin.settings.enableAICuration = choice.aiCuration === "yes";
    if (choice.provider === "ollama") {
        plugin.settings.apiFormat = "ollama" satisfies ApiFormat;
        if (choice.ollamaModel) plugin.settings.ollamaModel = choice.ollamaModel;
    } else if (choice.provider === "openai-compatible") {
        plugin.settings.apiFormat = "openai" satisfies ApiFormat;
        if (choice.openaiUrl) plugin.settings.ollamaUrl = choice.openaiUrl;
        if (choice.openaiModel) plugin.settings.ollamaModel = choice.openaiModel;
        if (choice.openaiKey !== undefined) plugin.settings.apiKey = choice.openaiKey;
    }
    await plugin.saveSettings();

    // Mark onboarding as handled — even pure dismiss flows set this, so
    // the modal stops re-appearing on every launch. We clear it on backend
    // failure below so the user gets a second chance.
    plugin.store?.setMeta("onboarding_dismissed", "1");

    try {
        await plugin.reloadBackends();
    } catch {
        // reloadBackends already showed a Notice. Clear the dismissed flag
        // so the user sees onboarding on next launch and can retry the
        // provider settings — otherwise they're stuck in broken-backend
        // state with no obvious recovery path.
        plugin.store?.setMeta("onboarding_dismissed", "");
        return;
    }

    if (choice.indexNow) {
        void plugin.rebuildIndex();
    }
}
