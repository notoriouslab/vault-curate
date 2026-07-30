// Settings tab — Phase 8 three-section layout (Quick / AI Curation / Advanced)
//
// Design D9: Quick Setup keeps the 3 onboarding-critical knobs visible;
// AI Curation is gated behind enableAICuration; Advanced is collapsed
// behind a <details> element so power-user knobs don't crowd the screen.

import { App, Modal, PluginSettingTab, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import type { EmbeddingProviderType } from "./types";
import { checkLLMReachable, fetchOllamaModels, formatLocalDateTime, isLoopbackHost } from "./utils";
import { t } from "./i18n";
import { DismissedModal } from "./ui/DismissedModal";

export class VaultSearchSettingTab extends PluginSettingTab {
    plugin: VaultSearchPlugin;
    /** Index-stats panel, re-rendered live when hotDays changes (010). */
    private statsEl: HTMLElement | null = null;
    /** Debounce for the live stats re-render — every keystroke in the
     *  hotDays field would otherwise trigger a full-vault tier sweep. */
    private statsTimer: number | null = null;

    constructor(app: App, plugin: VaultSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.buildQuickSetup(containerEl);
        this.buildAICuration(containerEl);
        this.buildAdvanced(containerEl);
        void this.loadModelOptions();
    }

    // ── Section 1: Quick Setup ─────────────────────────────────

    private buildQuickSetup(parent: HTMLElement) {
        new Setting(parent).setName(t.sectionQuickSetup).setHeading();

        const providerSetting = new Setting(parent)
            .setName(t.embeddingProvider);
        // If the backend failed to initialise at onload, the dropdown is
        // disabled — changing it would swap `this.provider` but
        // `rebuildIndex` would bail (no indexer), leaving the UI showing a
        // provider that isn't actually active. Surface that state instead
        // of letting the user fight a broken dropdown.
        const backendReady = !!this.plugin.indexer;
        // setDesc with \n is collapsed in Obsidian; build a fragment so each
        // line shows on its own. Obsidian's createFragment/createEl helpers
        // (1.2.1 audit: obsidianmd/prefer-create-el).
        const descFrag = createFragment(frag => {
            const lines = t.embeddingProviderDesc.split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) frag.createEl("br");
                frag.appendText(lines[i]);
            }
            if (!backendReady) {
                frag.createEl("br");
                frag.createEl("strong", { text: t.backendNotReady });
            }
        });
        providerSetting.setDesc(descFrag);
        providerSetting
            .addDropdown(drop => {
                drop.addOption("wasm", t.embeddingProviderBuiltin);
                drop.addOption("ollama", t.embeddingProviderOllama);
                drop.addOption("openai-compatible", t.embeddingProviderOpenAI);
                drop.setValue(this.plugin.settings.embeddingProvider);
                drop.setDisabled(!backendReady);
                drop.onChange(async (val) => {
                    const newProvider = val as EmbeddingProviderType;
                    const old = this.plugin.settings.embeddingProvider;
                    if (newProvider === old) return;
                    const confirmed = await this.confirmProviderSwitch();
                    if (!confirmed) {
                        drop.setValue(old);
                        return;
                    }
                    this.plugin.settings.embeddingProvider = newProvider;
                    await this.plugin.saveSettings();
                    try {
                        await this.plugin.reloadBackends();
                    } catch {
                        // reloadBackends already showed a Notice; swallow here
                        // so the onChange handler doesn't leak unhandled rejection.
                        return;
                    }
                    this.display();
                    void this.plugin.rebuildIndex();
                });
            });

        if (this.plugin.settings.embeddingProvider === "wasm") {
            const note = parent.createDiv({ cls: "vault-curate-note" });
            note.setText(t.builtinModelNote);
        } else {
            this.buildExternalEmbeddingFields(parent);
        }

        new Setting(parent)
            .setName(t.excludePatterns)
            .setDesc(t.excludePatternsDesc)
            .addTextArea(text => {
                text.setValue(this.plugin.settings.excludePatterns.join("\n"));
                text.onChange(async (val) => {
                    this.plugin.settings.excludePatterns = val
                        .split("\n")
                        .map(s => s.trim())
                        .filter(Boolean);
                    await this.plugin.saveSettings();
                });
            });
    }

    private buildExternalEmbeddingFields(parent: HTMLElement) {
        const urlSetting = new Setting(parent)
            .setName(t.ollamaUrl)
            .setDesc(t.ollamaUrlDesc)
            .addText(text => {
                text.setPlaceholder(t.urlPlaceholder);
                text.setValue(this.plugin.settings.ollamaUrl);
                text.onChange(async (val) => {
                    this.plugin.settings.ollamaUrl = val.trim();
                    await this.plugin.saveSettings();
                    this.updateRemoteWarning(urlSetting, val.trim());
                });
            });
        this.updateRemoteWarning(urlSetting, this.plugin.settings.ollamaUrl);

        new Setting(parent)
            .setName(t.apiFormat)
            .setDesc(t.apiFormatDesc)
            .addDropdown(drop => {
                drop.addOption("ollama", t.apiFormatOllama);
                drop.addOption("openai", t.apiFormatOpenAI);
                drop.setValue(this.plugin.settings.apiFormat);
                drop.onChange(async (val) => {
                    this.plugin.settings.apiFormat = val as "ollama" | "openai";
                    await this.plugin.saveSettings();
                    void this.loadModelOptions();
                });
            });

        new Setting(parent)
            .setName(t.apiKeyLabel)
            .setDesc(t.apiKeyDesc)
            .addText(text => {
                text.setPlaceholder(t.apiKeyPlaceholder);
                text.setValue(this.plugin.settings.apiKey);
                text.inputEl.type = "password";
                text.onChange(async (val) => {
                    this.plugin.settings.apiKey = val.trim();
                    await this.plugin.saveSettings();
                });
            });

        const embSetting = new Setting(parent)
            .setName(t.embeddingModel)
            .setDesc(t.embeddingModelDesc);
        this.addModelDropdown(embSetting, this.plugin.settings.ollamaModel, async (val) => {
            const old = this.plugin.settings.ollamaModel;
            if (val === old) return;
            const confirmed = await this.confirmProviderSwitch();
            if (!confirmed) {
                // Re-render so dropdown reverts visually.
                this.display();
                return;
            }
            this.plugin.settings.ollamaModel = val;
            await this.plugin.saveSettings();
            try {
                await this.plugin.reloadBackends();
            } catch {
                // Roll back the persisted setting + UI so we don't leave the
                // dropdown showing a model that the backend never accepted.
                // reloadBackends already showed a Notice to the user. Wrap
                // the rollback itself in try/catch so a secondary failure
                // (disk full / disposed store) doesn't escape as an
                // unhandled rejection from the onChange handler.
                try {
                    this.plugin.settings.ollamaModel = old;
                    await this.plugin.saveSettings();
                    this.display();
                } catch {
                    // Best-effort: rollback failed but the primary Notice
                    // from reloadBackends already informed the user.
                }
                return;
            }
            void this.plugin.rebuildIndex();
        }, "embedding");
    }

    // ── Section 2: AI Curation ─────────────────────────────────

    private buildAICuration(parent: HTMLElement) {
        new Setting(parent).setName(t.sectionAICuration).setHeading();

        new Setting(parent)
            .setName(t.enableAICuration)
            .setDesc(t.enableAICurationDesc)
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.enableAICuration);
                toggle.onChange(async (val) => {
                    this.plugin.settings.enableAICuration = val;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // Production path back to the Onboarding modal — survives a Skip
        // and doesn't require the dev command.
        new Setting(parent)
            .setName(t.rerunOnboarding)
            .setDesc(t.rerunOnboardingDesc)
            .addButton(btn => {
                btn.setButtonText(t.rerunOnboardingBtn);
                btn.onClick(() => this.plugin.showOnboardingModal());
            });

        if (!this.plugin.settings.enableAICuration) return;

        const llmSetting = new Setting(parent)
            .setName(t.llmModel)
            .setDesc(t.llmModelDesc);
        this.addModelDropdown(llmSetting, this.plugin.settings.llmModel, async (val) => {
            this.plugin.settings.llmModel = val;
            await this.plugin.saveSettings();
        }, "llm");

        // Endpoint reachability summary. Surfaces the actual URL the LLM
        // will hit and a live probe — resolves the "I flipped the toggle
        // but description generation does nothing" support pattern in the
        // Settings UI itself, instead of forcing users to run a command
        // just to discover their endpoint is down.
        const endpointSetting = new Setting(parent).setName(t.llmEndpointHeading);
        const desc = endpointSetting.descEl;
        desc.empty();
        const urlLine = desc.createDiv({ cls: "vault-curate-endpoint-url" });
        const statusLine = desc.createDiv({ cls: "vault-curate-endpoint-status" });
        const hintLine = desc.createDiv({ cls: "vault-curate-endpoint-hint" });
        endpointSetting.addButton(btn => {
            btn.setButtonText(t.llmEndpointRecheck);
            btn.onClick(() => {
                void this.renderLLMStatus(urlLine, statusLine, hintLine);
            });
        });
        void this.renderLLMStatus(urlLine, statusLine, hintLine);
    }

    private async renderLLMStatus(
        urlLine: HTMLElement,
        statusLine: HTMLElement,
        hintLine: HTMLElement,
    ) {
        const settings = this.plugin.settings;
        const protocolLabel = settings.apiFormat === "ollama" ? "Ollama" : "OpenAI-compatible";
        urlLine.setText(`${protocolLabel} @ ${settings.ollamaUrl}`);
        statusLine.setText(t.llmEndpointProbing);
        hintLine.empty();
        const status = await checkLLMReachable({
            ollamaUrl: settings.ollamaUrl,
            apiFormat: settings.apiFormat,
            apiKey: settings.apiKey,
        });
        if (status.reachable) {
            statusLine.setText(t.llmEndpointReachable);
        } else {
            statusLine.setText(t.llmEndpointUnreachable(status.reason ?? "unknown"));
            hintLine.setText(t.llmEndpointHint);
        }
    }

    // ── Section 3: Advanced (collapsed) ────────────────────────

    private buildAdvanced(parent: HTMLElement) {
        const details = parent.createEl("details", { cls: "vault-curate-advanced" });
        details.createEl("summary", {
            text: t.sectionAdvanced,
            cls: "vault-curate-advanced-summary",
        });
        const adv = details;

        new Setting(adv)
            .setName(t.topResults)
            .setDesc(t.topResultsDesc)
            .addText(text => {
                text.setValue(String(this.plugin.settings.topResults));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n > 0) {
                        this.plugin.settings.topResults = Math.min(n, 100);
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(adv)
            .setName(t.minScore)
            .setDesc(t.minScoreDesc)
            .addText(text => {
                text.setValue(String(this.plugin.settings.minScore));
                text.onChange(async (val) => {
                    const n = parseFloat(val);
                    if (!isNaN(n) && n >= 0 && n <= 1) {
                        this.plugin.settings.minScore = n;
                        await this.plugin.saveSettings();
                    }
                });
            });

        // Semantic Canvas Graph (006): destination folder for generated
        // .canvas files. Empty = vault root.
        new Setting(adv)
            .setName(t.settingCanvasFolder)
            .setDesc(t.settingCanvasFolderDesc)
            .addText(text => {
                text.setValue(this.plugin.settings.canvasFolder);
                text.onChange(async (val) => {
                    this.plugin.settings.canvasFolder = val;
                    await this.plugin.saveSettings();
                });
            });

        // Purple-edge promotion (010 D7)
        new Setting(adv)
            .setName(t.settingRelatedSection)
            .setDesc(t.settingRelatedSectionDesc)
            .addText(text => {
                text.setPlaceholder(t.relatedSectionDefault);
                text.setValue(this.plugin.settings.relatedSectionTitle);
                text.onChange(async (val) => {
                    this.plugin.settings.relatedSectionTitle = val;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(adv)
            .setName(t.settingPromoteBidirectional)
            .setDesc(t.settingPromoteBidirectionalDesc)
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.promoteBidirectional);
                toggle.onChange(async (val) => {
                    this.plugin.settings.promoteBidirectional = val;
                    await this.plugin.saveSettings();
                });
            });

        // 013 D6: dismissed suggestions — count + manage modal.
        const dismissedCount = () =>
            Object.keys(this.plugin.settings.dismissedPairs).length +
            Object.keys(this.plugin.settings.dismissedNotes).length;
        const dismissedSetting = new Setting(adv)
            .setName(t.dismissedHeading)
            .setDesc(t.dismissedManageDesc(dismissedCount()));
        dismissedSetting.addButton(btn => {
            btn.setButtonText(t.dismissedManage);
            btn.onClick(() => {
                new DismissedModal(this.app, this.plugin, () => {
                    dismissedSetting.setDesc(t.dismissedManageDesc(dismissedCount()));
                }).open();
            });
        });

        new Setting(adv)
            .setName(t.maxEmbedChars)
            .setDesc(t.maxEmbedCharsDesc)
            .addText(text => {
                text.setValue(String(this.plugin.settings.maxEmbedChars));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n > 0) {
                        this.plugin.settings.maxEmbedChars = n;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(adv)
            .setName(t.hotDays)
            .setDesc(t.hotDaysDesc)
            .addText(text => {
                text.setValue(String(this.plugin.settings.hotDays));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n > 0) {
                        this.plugin.settings.hotDays = n;
                        await this.plugin.saveSettings();
                        // 010: tier derives at query time, so the stats
                        // panel below must follow the new window live —
                        // stale numbers here read as "needs re-index".
                        // Debounced: typing "365" is three keystrokes and
                        // each sweep walks the whole vault.
                        if (this.statsTimer !== null) window.clearTimeout(this.statsTimer);
                        this.statsTimer = window.setTimeout(() => this.renderStats(), 300);
                    }
                });
            });

        new Setting(adv)
            .setName(t.searchScope)
            .setDesc(t.searchScopeDesc)
            .addDropdown(drop => {
                drop.addOption("hot", t.scopeHot);
                drop.addOption("all", t.scopeAll);
                drop.addOption("cold", t.scopeCold);
                drop.setValue(this.plugin.settings.searchScope);
                drop.onChange(async (val) => {
                    this.plugin.settings.searchScope = val as "hot" | "all" | "cold";
                    await this.plugin.saveSettings();
                });
            });

        new Setting(adv)
            .setName(t.chunkSize)
            .setDesc(t.chunkSizeDesc)
            .addText(text => {
                text.setValue(String(this.plugin.settings.chunkSize));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n >= 200) {
                        this.plugin.settings.chunkSize = n;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(adv)
            .setName(t.chunkOverlap)
            .setDesc(t.chunkOverlapDesc)
            .addText(text => {
                text.setValue(String(this.plugin.settings.chunkOverlap));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n >= 0 && n < this.plugin.settings.chunkSize) {
                        this.plugin.settings.chunkOverlap = n;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(adv)
            .setName(t.synonymsLabel)
            .setDesc(t.synonymsDesc)
            .addTextArea(text => {
                const lines = Object.entries(this.plugin.settings.synonyms)
                    .map(([k, v]) => `${k} = ${v.join(", ")}`);
                text.setValue(lines.join("\n"));
                text.inputEl.rows = 6;
                text.inputEl.addClass("vault-curate-synonyms-input");
                text.onChange(async (val) => {
                    const result: Record<string, string[]> = {};
                    for (const line of val.split("\n")) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.includes("=")) continue;
                        const [key, rest] = trimmed.split("=", 2);
                        const k = key.trim();
                        if (!k || !rest) continue;
                        result[k] = rest.split(",").map(s => s.trim()).filter(Boolean);
                    }
                    this.plugin.settings.synonyms = result;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(adv)
            .setName(t.autoIndex)
            .setDesc(t.autoIndexDesc)
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.autoIndex);
                toggle.onChange(async (val) => {
                    this.plugin.settings.autoIndex = val;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(adv).setName(t.actions).setHeading();

        new Setting(adv)
            .setName(t.rebuildIndex)
            .setDesc(t.rebuildIndexDesc)
            .addButton(btn => {
                btn.setButtonText(t.rebuildBtn);
                btn.setCta();
                btn.onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText(t.indexingBtn);
                    await this.plugin.rebuildIndex();
                    btn.setDisabled(false);
                    btn.setButtonText(t.rebuildBtn);
                    this.display();
                });
            });

        new Setting(adv)
            .setName(t.updateIndex)
            .setDesc(t.updateIndexDesc)
            .addButton(btn => {
                btn.setButtonText(t.updateBtn);
                btn.onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText(t.updatingBtn);
                    await this.plugin.updateIndex();
                    btn.setDisabled(false);
                    btn.setButtonText(t.updateBtn);
                    this.display();
                });
            });

        if (this.plugin.store) {
            new Setting(adv).setName(t.indexStats).setHeading();
            this.statsEl = adv.createDiv({ cls: "vault-curate-stats" });
            this.renderStats();
        }
    }

    /** (Re)fill the index-stats panel. Called from display() and from the
     *  hotDays onChange — tier derives at query time (010 D5), so this
     *  panel must track the setting live to stay consistent with Discover
     *  (same-state-multiple-surfaces). */
    private renderStats() {
        const store = this.plugin.store;
        const stats = this.statsEl;
        if (!store || !stats) return;
        stats.empty();
        const allBody = store.getAllBodyVecs();
        let hotCount = 0;
        let coldCount = 0;
        const tierResolver = this.plugin.tierResolver();
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

    // ── Modal + helpers ────────────────────────────────────────

    /** Show a destructive-action confirm modal; resolves to user's choice. */
    private confirmProviderSwitch(): Promise<boolean> {
        return new Promise((resolve) => {
            const noteCount = this.plugin.store?.getAllBodyVecs().size ?? 0;
            new ProviderSwitchModal(this.app, noteCount, resolve).open();
        });
    }

    private addModelDropdown(
        setting: Setting,
        currentValue: string,
        onChange: (val: string) => Promise<void>,
        filterType?: "embedding" | "llm",
    ) {
        setting.addDropdown(drop => {
            drop.addOption("", "Loading...");
            if (currentValue) drop.addOption(currentValue, currentValue);
            drop.setValue(currentValue);
            drop.onChange(onChange);
            drop.selectEl.dataset.modelDropdown = filterType ?? "all";
        });
    }

    private updateRemoteWarning(setting: Setting, url: string) {
        const existing = setting.settingEl.querySelector(".vault-curate-remote-warn");
        if (existing) existing.remove();
        const existingHttp = setting.settingEl.querySelector(".vault-curate-http-warn");
        if (existingHttp) existingHttp.remove();
        try {
            const parsed = new URL(url);
            const isLocal = isLoopbackHost(parsed.hostname);
            if (!isLocal) {
                const warn = setting.settingEl.createDiv({ cls: "vault-curate-remote-warn" });
                warn.setText(t.remoteWarning);
            }
            if (parsed.protocol === "http:" && !isLocal && this.plugin.settings.apiKey) {
                const warn = setting.settingEl.createDiv({ cls: "vault-curate-http-warn vault-curate-remote-warn" });
                warn.setText(t.httpApiKeyWarning);
            }
        } catch { /* invalid URL, ignore */ }
    }

    /**
     * Populate the model dropdowns (LLM + embedding) from the configured
     * Ollama / OpenAI-compatible endpoint. Built-in provider has nothing
     * to fetch — bail early.
     */
    private async loadModelOptions() {
        // Fetch when either dropdown needs it: embedding dropdown (non-wasm provider)
        // OR LLM dropdown (AI curation enabled). Bailing on wasm alone broke the
        // "wasm embedding + Ollama LLM" combo — users had no UI path to switch models.
        const needsEmbeddingFetch = this.plugin.settings.embeddingProvider !== "wasm";
        const needsLLMFetch = this.plugin.settings.enableAICuration;
        if (!needsEmbeddingFetch && !needsLLMFetch) return;
        const models = await fetchOllamaModels(this.plugin.settings.ollamaUrl, this.plugin.settings.apiFormat);
        if (models.length === 0) return;

        const dropdowns = this.containerEl.querySelectorAll("select[data-model-dropdown]");
        dropdowns.forEach((selectEl) => {
            const select = selectEl as HTMLSelectElement;
            const currentValue = select.value;
            const filterType = select.dataset.modelDropdown;

            select.empty();
            select.createEl("option", { value: "", text: t.selectModel });

            const filtered = models.filter(m => {
                if (filterType === "embedding") return m.isEmbedding;
                if (filterType === "llm") return !m.isEmbedding;
                return true;
            });

            for (const m of filtered) {
                let label = m.name;
                if (m.sizeGB > 0) {
                    const sizeLabel = m.sizeGB < 1
                        ? `${(m.sizeGB * 1000).toFixed(0)}MB`
                        : `${m.sizeGB.toFixed(1)}GB`;
                    label = `${m.name} (${sizeLabel})`;
                }
                select.createEl("option", { value: m.name, text: label });
            }
            select.value = currentValue;
        });
    }
}

class ProviderSwitchModal extends Modal {
    private decided = false;

    constructor(
        app: App,
        private noteCount: number,
        private onResult: (confirmed: boolean) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(t.providerSwitchTitle);
        this.contentEl.createEl("p", { text: t.providerSwitchBody(this.noteCount) });

        const btnRow = this.contentEl.createDiv({ cls: "vault-curate-modal-btnrow" });

        const cancelBtn = btnRow.createEl("button", { text: t.providerSwitchCancel });
        cancelBtn.addEventListener("click", () => this.resolve(false));

        const confirmBtn = btnRow.createEl("button", { text: t.providerSwitchConfirm });
        confirmBtn.addClass("mod-warning");
        confirmBtn.addEventListener("click", () => this.resolve(true));

        // Esc handler — same path as button cancel. Backdrop click + X are
        // covered by onClose() so the promise resolves even when the user
        // dismisses without clicking a button.
        this.scope.register([], "Escape", () => this.resolve(false));
    }

    onClose(): void {
        // Backdrop / X dismissal arrives here without going through resolve().
        // Treat as cancel so the caller's promise never hangs and the dropdown
        // can revert to its prior value.
        if (!this.decided) this.onResult(false);
        this.contentEl.empty();
    }

    private resolve(confirmed: boolean): void {
        if (this.decided) return;
        this.decided = true;
        this.onResult(confirmed);
        this.close();
    }
}
