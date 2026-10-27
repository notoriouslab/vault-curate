// AI-curation rows: the gate toggle, API format, curation server, LLM model,
// endpoint probe and the onboarding re-run. Split out of definitions.ts; the
// bodies are unchanged.

import { Platform } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";
import type { SettingsContext } from "./types";
import { clearRemoteWarning, renderModelDropdown, updateRemoteWarning } from "./rowHelpers";
import type { Predicate } from "./rowHelpers";
import { checkLLMReachable } from "../utils";
import { resolveLlmUrl } from "../utils/resolveLlmUrl";
import { resolveLlmApiKey } from "../utils/resolveLlmApiKey";
import { normalizeAiOutputLanguage } from "../utils/aiOutputLanguage";
import { t } from "../i18n";

export function enableAICurationRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.enableAICuration,
        desc: t.enableAICurationDesc,
        render: (setting) => {
            setting.addToggle(toggle => {
                toggle.setValue(ctx.plugin.settings.enableAICuration);
                toggle.onChange(async (val) => {
                    ctx.plugin.settings.enableAICuration = val;
                    await ctx.plugin.saveSettings();
                    // Full re-render, not just predicates: the gated rows were
                    // rendered hidden with their network work skipped, so they
                    // need a real render pass now that they are shown.
                    ctx.refresh();
                });
            });
        },
    };
}

export function apiFormatRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    // 024: apiFormat lives here — its only consumers are the LLM request
    // path and the LLM model listing, never the embedding data path (that
    // one is picked by embeddingProvider).
    return {
        name: t.apiFormat,
        desc: t.apiFormatDesc,
        visible,
        render: (setting) => {
            setting.addDropdown(drop => {
                drop.addOption("ollama", t.apiFormatOllama);
                drop.addOption("openai", t.apiFormatOpenAI);
                drop.setValue(ctx.plugin.settings.apiFormat);
                drop.onChange(async (val) => {
                    ctx.plugin.settings.apiFormat = val as "ollama" | "openai";
                    await ctx.plugin.saveSettings();
                    ctx.refresh();
                    if (Platform.isMobile) ctx.plugin.refreshMobileProvider(); // 015
                });
            });
        },
    };
}

export function llmUrlRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    // 023: optional LLM-only server. Empty = the embedding server above.
    return {
        name: t.llmUrlName,
        desc: t.llmUrlDesc,
        visible,
        render: (setting) => {
            setting.addText(text => {
                text.setPlaceholder(ctx.plugin.settings.ollamaUrl);
                text.setValue(ctx.plugin.settings.llmUrl);
                text.onChange(async (val) => {
                    ctx.plugin.settings.llmUrl = val.trim();
                    await ctx.plugin.saveSettings();
                    refreshWarning();
                });
                text.inputEl.addEventListener("input", () => ctx.warningsChanged());
                // The model list and endpoint probe follow the new address
                // once the field is left; one request per edit (042 D7).
                text.inputEl.addEventListener("change", () => ctx.serverChanged());
            });
            const refreshWarning = () => updateRemoteWarning(
                setting,
                resolveLlmUrl(ctx.plugin.settings.llmUrl, ctx.plugin.settings.ollamaUrl),
                resolveLlmApiKey(ctx.plugin.settings),
            );
            refreshWarning();
            // The http-with-key warning also depends on the key, typed later.
            const unsubscribe = ctx.onWarningsChange(refreshWarning);
            return () => {
                unsubscribe();
                clearRemoteWarning(setting);
            };
        },
    };
}

export function llmApiKeyRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    // 041 D4: AI curation's own key, right under its server. Shows the raw
    // value (D1 exception): showing the resolved key would save the reused
    // embedding key here the moment the field is edited.
    return {
        name: t.llmApiKeyName,
        desc: t.llmApiKeyDesc,
        visible,
        render: (setting) => {
            setting.addText(text => {
                text.setPlaceholder(t.apiKeyPlaceholder);
                text.setValue(ctx.plugin.settings.llmApiKey);
                text.inputEl.type = "password";
                text.onChange(async (val) => {
                    ctx.plugin.settings.llmApiKey = val.trim();
                    await ctx.plugin.saveSettings();
                });
                // The http warning follows each keystroke; the LLM model list
                // and the probe send this key, so they reload once the field
                // is left (042 D7).
                text.inputEl.addEventListener("input", () => ctx.warningsChanged());
                text.inputEl.addEventListener("change", () => ctx.serverChanged());
            });
        },
    };
}

export function llmModelRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    return {
        name: t.llmModel,
        desc: t.llmModelDesc,
        visible,
        render: (setting) => renderModelDropdown(setting, {
            ctx,
            kind: "llm",
            current: () => ctx.plugin.settings.llmModel,
            active: visible,
            onChange: async (val) => {
                ctx.plugin.settings.llmModel = val;
                await ctx.plugin.saveSettings();
            },
        }),
    };
}

export function aiOutputLanguageRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    // 036 D8: listed languages use prompts written in that language; the
    // endonym labels are the same in every interface language.
    return {
        name: t.aiOutputLanguage,
        desc: t.aiOutputLanguageDesc,
        visible,
        render: (setting) => {
            setting.addDropdown(drop => {
                drop.addOption("auto", t.aiOutputLanguageAuto);
                drop.addOption("en", "English");
                drop.addOption("zh-TW", "繁體中文");
                drop.addOption("zh-CN", "简体中文");
                drop.addOption("custom", t.aiOutputLanguageCustomOption);
                drop.setValue(ctx.plugin.settings.aiOutputLanguage);
                drop.onChange(async (val) => {
                    ctx.plugin.settings.aiOutputLanguage = normalizeAiOutputLanguage(val);
                    await ctx.plugin.saveSettings();
                    // Only the custom-name row's visibility depends on this.
                    ctx.refreshPredicates();
                });
            });
        },
    };
}

export function aiOutputLanguageCustomRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    return {
        name: t.aiOutputLanguageCustomName,
        desc: t.aiOutputLanguageCustomDesc,
        visible,
        render: (setting) => {
            setting.addText(text => {
                text.setPlaceholder("Français");
                text.setValue(ctx.plugin.settings.aiOutputLanguageCustom);
                // Save only: a re-render would steal focus mid-typing.
                text.onChange(async (val) => {
                    ctx.plugin.settings.aiOutputLanguageCustom = val;
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

export function llmEndpointRow(ctx: SettingsContext, visible: Predicate): SettingDefinitionRender {
    // Endpoint reachability summary. Surfaces the actual URL the LLM will
    // hit and a live probe — resolves the "I flipped the toggle but
    // description generation does nothing" support pattern in the Settings
    // UI itself, instead of forcing users to run a command just to discover
    // their endpoint is down.
    return {
        name: t.llmEndpointHeading,
        visible,
        render: (setting) => {
            // Hidden row (curation off): no probe. ctx.refresh() on the
            // toggle re-renders this row for real once it is shown.
            if (!visible()) return;
            let disposed = false;
            // Each probe bumps this; an answer for an older address is dropped.
            let generation = 0;
            const desc = setting.descEl;
            desc.empty();
            const urlLine = desc.createDiv({ cls: "vault-curate-endpoint-url" });
            const statusLine = desc.createDiv({ cls: "vault-curate-endpoint-status" });
            const hintLine = desc.createDiv({ cls: "vault-curate-endpoint-hint" });
            const probe = async () => {
                const gen = ++generation;
                const settings = ctx.plugin.settings;
                const protocolLabel = settings.apiFormat === "ollama" ? "Ollama" : "OpenAI-compatible";
                // 023: probe (and show) the URL curation will actually hit.
                const effectiveUrl = resolveLlmUrl(settings.llmUrl, settings.ollamaUrl);
                urlLine.setText(`${protocolLabel} @ ${effectiveUrl}`);
                statusLine.setText(t.llmEndpointProbing);
                hintLine.empty();
                const status = await checkLLMReachable({
                    ollamaUrl: effectiveUrl,
                    apiFormat: settings.apiFormat,
                    apiKey: resolveLlmApiKey(settings),
                });
                // The row may be gone, or the address edited, by the time the probe answers.
                if (disposed || gen !== generation) return;
                if (status.reachable) {
                    statusLine.setText(t.llmEndpointReachable);
                } else {
                    statusLine.setText(t.llmEndpointUnreachable(status.reason ?? "unknown"));
                    hintLine.setText(t.llmEndpointHint);
                }
            };
            setting.addButton(btn => {
                btn.setButtonText(t.llmEndpointRecheck);
                btn.onClick(() => { void probe(); });
            });
            void probe();
            const unsubscribe = ctx.onServerChange(() => { void probe(); });
            return () => {
                disposed = true;
                unsubscribe();
            };
        },
    };
}
