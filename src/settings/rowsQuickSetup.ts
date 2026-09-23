// Quick-setup rows: embedding provider, endpoint, API key, embedding model
// and exclude patterns. Split out of definitions.ts; the bodies are unchanged.

import { Platform } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";
import type { SettingsContext } from "./types";
import type { EmbeddingProviderType } from "../types";
import { clearRemoteWarning, renderModelDropdown, updateRemoteWarning } from "./rowHelpers";
import type { Predicate } from "./rowHelpers";
import { t } from "../i18n";

export function providerRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.embeddingProvider,
        render: (setting) => {
            // If the backend failed to initialise at onload, the dropdown is
            // disabled — changing it would swap `this.provider` but
            // `rebuildIndex` would bail (no indexer), leaving the UI showing a
            // provider that isn't actually active. Surface that state instead
            // of letting the user fight a broken dropdown.
            const backendReady = !!ctx.plugin.indexer;
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
            setting.setDesc(descFrag);
            setting.addDropdown(drop => {
                drop.addOption("wasm", t.embeddingProviderBuiltin);
                drop.addOption("ollama", t.embeddingProviderOllama);
                drop.addOption("openai-compatible", t.embeddingProviderOpenAI);
                drop.setValue(ctx.plugin.settings.embeddingProvider);
                drop.setDisabled(!backendReady);
                drop.onChange(async (val) => {
                    const newProvider = val as EmbeddingProviderType;
                    const old = ctx.plugin.settings.embeddingProvider;
                    if (newProvider === old) return;
                    const confirmed = await ctx.confirmProviderSwitch();
                    if (!confirmed) {
                        drop.setValue(old);
                        return;
                    }
                    ctx.plugin.settings.embeddingProvider = newProvider;
                    await ctx.plugin.saveSettings();
                    try {
                        await ctx.plugin.reloadBackends();
                    } catch {
                        // reloadBackends already showed a Notice; swallow here
                        // so the onChange handler doesn't leak unhandled rejection.
                        return;
                    }
                    ctx.refresh();
                    void ctx.plugin.rebuildIndex();
                });
            });
        },
    };
}

export function ollamaUrlRow(ctx: SettingsContext, visible?: Predicate): SettingDefinitionRender {
    return {
        name: t.ollamaUrl,
        desc: t.ollamaUrlDesc,
        visible,
        render: (setting) => {
            setting.addText(text => {
                text.setPlaceholder(t.urlPlaceholder);
                text.setValue(ctx.plugin.settings.ollamaUrl);
                text.onChange(async (val) => {
                    ctx.plugin.settings.ollamaUrl = val.trim();
                    await ctx.plugin.saveSettings();
                    updateRemoteWarning(ctx, setting, val.trim());
                    if (Platform.isMobile) ctx.plugin.refreshMobileProvider(); // 015: layer 0↔2 flip
                });
            });
            updateRemoteWarning(ctx, setting, ctx.plugin.settings.ollamaUrl);
            return () => clearRemoteWarning(setting);
        },
    };
}

export function apiKeyRow(ctx: SettingsContext, visible?: Predicate): SettingDefinitionRender {
    return {
        name: t.apiKeyLabel,
        desc: t.apiKeyDesc,
        visible,
        render: (setting) => {
            setting.addText(text => {
                text.setPlaceholder(t.apiKeyPlaceholder);
                text.setValue(ctx.plugin.settings.apiKey);
                text.inputEl.type = "password";
                text.onChange(async (val) => {
                    ctx.plugin.settings.apiKey = val.trim();
                    await ctx.plugin.saveSettings();
                    if (Platform.isMobile) ctx.plugin.refreshMobileProvider(); // 015
                });
            });
        },
    };
}

export function embeddingModelRow(ctx: SettingsContext, visible?: Predicate): SettingDefinitionRender {
    return {
        name: t.embeddingModel,
        desc: t.embeddingModelDesc,
        visible,
        render: (setting) => renderModelDropdown(setting, {
            ctx,
            kind: "embedding",
            current: ctx.plugin.settings.ollamaModel,
            active: visible ?? (() => true),
            onChange: async (val) => {
                const old = ctx.plugin.settings.ollamaModel;
                if (val === old) return;
                // 015 review C1: on mobile the desktop flow below is wrong twice
                // over — reloadBackends() bypasses the D3 decision table
                // (buildMobileProvider) and rebuildIndex() fires a bogus
                // "backend not ready" notice (no indexer exists on mobile).
                // Mobile just swaps the provider; the index stays desktop-built.
                if (Platform.isMobile) {
                    ctx.plugin.settings.ollamaModel = val;
                    await ctx.plugin.saveSettings();
                    ctx.plugin.refreshMobileProvider();
                    return;
                }
                const confirmed = await ctx.confirmProviderSwitch();
                if (!confirmed) {
                    // Re-render so dropdown reverts visually.
                    ctx.refresh();
                    return;
                }
                ctx.plugin.settings.ollamaModel = val;
                await ctx.plugin.saveSettings();
                try {
                    await ctx.plugin.reloadBackends();
                } catch {
                    // Roll back the persisted setting + UI so we don't leave the
                    // dropdown showing a model that the backend never accepted.
                    // reloadBackends already showed a Notice to the user. Wrap
                    // the rollback itself in try/catch so a secondary failure
                    // (disk full / disposed store) doesn't escape as an
                    // unhandled rejection from the onChange handler.
                    try {
                        ctx.plugin.settings.ollamaModel = old;
                        await ctx.plugin.saveSettings();
                        ctx.refresh();
                    } catch {
                        // Best-effort: rollback failed but the primary Notice
                        // from reloadBackends already informed the user.
                    }
                    return;
                }
                void ctx.plugin.rebuildIndex();
            },
        }),
    };
}

export function excludePatternsRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.excludePatterns,
        desc: t.excludePatternsDesc,
        render: (setting) => {
            setting.addTextArea(text => {
                text.setValue(ctx.plugin.settings.excludePatterns.join("\n"));
                text.onChange(async (val) => {
                    ctx.plugin.settings.excludePatterns = val
                        .split("\n")
                        .map(s => s.trim())
                        .filter(Boolean);
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}
