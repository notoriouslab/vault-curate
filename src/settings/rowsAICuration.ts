// AI-curation rows: the gate toggle, API format, curation server, LLM model,
// endpoint probe and the onboarding re-run. Split out of definitions.ts; the
// bodies are unchanged.

import { Platform } from "obsidian";
import type { SettingDefinitionAction, SettingDefinitionRender } from "obsidian";
import type { SettingsContext } from "./types";
import { clearRemoteWarning, renderModelDropdown, updateRemoteWarning } from "./rowHelpers";
import type { Predicate } from "./rowHelpers";
import { checkLLMReachable } from "../utils";
import { resolveLlmUrl } from "../utils/resolveLlmUrl";
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
                    ctx.refreshPredicates();
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
                    updateRemoteWarning(
                        ctx,
                        setting,
                        resolveLlmUrl(ctx.plugin.settings.llmUrl, ctx.plugin.settings.ollamaUrl),
                    );
                });
            });
            updateRemoteWarning(
                ctx,
                setting,
                resolveLlmUrl(ctx.plugin.settings.llmUrl, ctx.plugin.settings.ollamaUrl),
            );
            return () => clearRemoteWarning(setting);
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
            current: ctx.plugin.settings.llmModel,
            onChange: async (val) => {
                ctx.plugin.settings.llmModel = val;
                await ctx.plugin.saveSettings();
            },
        }),
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
            let disposed = false;
            const desc = setting.descEl;
            desc.empty();
            const urlLine = desc.createDiv({ cls: "vault-curate-endpoint-url" });
            const statusLine = desc.createDiv({ cls: "vault-curate-endpoint-status" });
            const hintLine = desc.createDiv({ cls: "vault-curate-endpoint-hint" });
            const probe = async () => {
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
                    apiKey: settings.apiKey,
                });
                // The row may be gone by the time the probe answers.
                if (disposed) return;
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
            return () => { disposed = true; };
        },
    };
}

export function rerunOnboardingRow(ctx: SettingsContext): SettingDefinitionAction {
    // Production path back to the Onboarding modal — survives a Skip and
    // doesn't require the dev command. Last in the section and outside the
    // gate: still reachable with AI curation off (024).
    return {
        name: t.rerunOnboarding,
        desc: t.rerunOnboardingDesc,
        action: () => ctx.plugin.showOnboardingModal(),
    };
}
