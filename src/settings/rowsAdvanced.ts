// Advanced-page rows (query params, promotion, chunking, actions, stats) plus
// the mobile-only index-card rows. Split out of definitions.ts; the bodies are
// unchanged.

import type { SettingDefinitionRender } from "obsidian";
import type { SettingsContext } from "./types";
import { renderStatsInto, runIndexAction } from "./rowHelpers";
import type { Predicate } from "./rowHelpers";
import { t } from "../i18n";
import { DismissedModal } from "../ui/DismissedModal";

export function topResultsRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.topResults,
        desc: t.topResultsDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setValue(String(ctx.plugin.settings.topResults));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n > 0) {
                        ctx.plugin.settings.topResults = Math.min(n, 100);
                        await ctx.plugin.saveSettings();
                    }
                });
            });
        },
    };
}

export function minScoreRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.minScore,
        desc: t.minScoreDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setValue(String(ctx.plugin.settings.minScore));
                text.onChange(async (val) => {
                    const n = parseFloat(val);
                    if (!isNaN(n) && n >= 0 && n <= 1) {
                        ctx.plugin.settings.minScore = n;
                        await ctx.plugin.saveSettings();
                    }
                });
            });
        },
    };
}

export function searchScopeRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.searchScope,
        desc: t.searchScopeDesc,
        render: (setting) => {
            setting.addDropdown(drop => {
                drop.addOption("hot", t.scopeHot);
                drop.addOption("all", t.scopeAll);
                drop.addOption("cold", t.scopeCold);
                drop.setValue(ctx.plugin.settings.searchScope);
                drop.onChange(async (val) => {
                    ctx.plugin.settings.searchScope = val as "hot" | "all" | "cold";
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

/** 013 D6: dismissed suggestions — count + manage modal. The count is read
 *  at render time and refreshed in place when the modal closes. */
export function dismissedRow(ctx: SettingsContext): SettingDefinitionRender {
    const dismissedCount = () =>
        Object.keys(ctx.plugin.settings.dismissedPairs).length +
        Object.keys(ctx.plugin.settings.dismissedNotes).length;
    return {
        name: t.dismissedHeading,
        // Build-time count feeds the search index; render refreshes it live.
        desc: t.dismissedManageDesc(dismissedCount()),
        render: (setting) => {
            setting.setDesc(t.dismissedManageDesc(dismissedCount()));
            setting.addButton(btn => {
                btn.setButtonText(t.dismissedManage);
                btn.onClick(() => {
                    new DismissedModal(ctx.app, ctx.plugin, () => {
                        setting.setDesc(t.dismissedManageDesc(dismissedCount()));
                    }).open();
                });
            });
        },
    };
}

export function canvasFolderRow(ctx: SettingsContext): SettingDefinitionRender {
    // Semantic Canvas Graph (006): destination folder for generated .canvas
    // files. Empty = vault root.
    return {
        name: t.settingCanvasFolder,
        desc: t.settingCanvasFolderDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setValue(ctx.plugin.settings.canvasFolder);
                text.onChange(async (val) => {
                    ctx.plugin.settings.canvasFolder = val;
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

export function relatedSectionRow(ctx: SettingsContext): SettingDefinitionRender {
    // Purple-edge promotion (010 D7)
    return {
        name: t.settingRelatedSection,
        desc: t.settingRelatedSectionDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setPlaceholder(t.relatedSectionDefault);
                text.setValue(ctx.plugin.settings.relatedSectionTitle);
                text.onChange(async (val) => {
                    ctx.plugin.settings.relatedSectionTitle = val;
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

export function promoteBidirectionalRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.settingPromoteBidirectional,
        desc: t.settingPromoteBidirectionalDesc,
        render: (setting) => {
            setting.addToggle(toggle => {
                toggle.setValue(ctx.plugin.settings.promoteBidirectional);
                toggle.onChange(async (val) => {
                    ctx.plugin.settings.promoteBidirectional = val;
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

export function maxEmbedCharsRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.maxEmbedChars,
        desc: t.maxEmbedCharsDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setValue(String(ctx.plugin.settings.maxEmbedChars));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n > 0) {
                        ctx.plugin.settings.maxEmbedChars = n;
                        await ctx.plugin.saveSettings();
                    }
                });
            });
        },
    };
}

export function hotDaysRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.hotDays,
        desc: t.hotDaysDesc,
        render: (setting) => {
            let statsTimer: number | null = null;
            setting.addText(text => {
                text.setValue(String(ctx.plugin.settings.hotDays));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n > 0) {
                        ctx.plugin.settings.hotDays = n;
                        await ctx.plugin.saveSettings();
                        // 010: tier derives at query time, so the stats
                        // panel below must follow the new window live —
                        // stale numbers here read as "needs re-index".
                        // Debounced: typing "365" is three keystrokes and
                        // each sweep walks the whole vault.
                        if (statsTimer !== null) window.clearTimeout(statsTimer);
                        // Only the stats panel redraws: a full refresh would
                        // rebuild this very input and steal its focus.
                        statsTimer = window.setTimeout(() => ctx.refreshStats(), 300);
                    }
                });
            });
            return () => {
                if (statsTimer !== null) window.clearTimeout(statsTimer);
            };
        },
    };
}

export function chunkSizeRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.chunkSize,
        desc: t.chunkSizeDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setValue(String(ctx.plugin.settings.chunkSize));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n >= 200) {
                        ctx.plugin.settings.chunkSize = n;
                        await ctx.plugin.saveSettings();
                    }
                });
            });
        },
    };
}

export function chunkOverlapRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.chunkOverlap,
        desc: t.chunkOverlapDesc,
        render: (setting) => {
            setting.addText(text => {
                text.setValue(String(ctx.plugin.settings.chunkOverlap));
                text.onChange(async (val) => {
                    const n = parseInt(val, 10);
                    if (!isNaN(n) && n >= 0 && n < ctx.plugin.settings.chunkSize) {
                        ctx.plugin.settings.chunkOverlap = n;
                        await ctx.plugin.saveSettings();
                    }
                });
            });
        },
    };
}

export function synonymsRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.synonymsLabel,
        desc: t.synonymsDesc,
        render: (setting) => {
            setting.addTextArea(text => {
                const lines = Object.entries(ctx.plugin.settings.synonyms)
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
                    ctx.plugin.settings.synonyms = result;
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

export function autoIndexRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.autoIndex,
        desc: t.autoIndexDesc,
        render: (setting) => {
            setting.addToggle(toggle => {
                toggle.setValue(ctx.plugin.settings.autoIndex);
                toggle.onChange(async (val) => {
                    ctx.plugin.settings.autoIndex = val;
                    await ctx.plugin.saveSettings();
                });
            });
        },
    };
}

export function rebuildIndexRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.rebuildIndex,
        desc: t.rebuildIndexDesc,
        render: (setting) => {
            setting.addButton(btn => {
                btn.setButtonText(t.rebuildBtn);
                btn.setCta();
                btn.onClick(() => runIndexAction(ctx, btn, t.rebuildBtn, t.indexingBtn, () => ctx.plugin.rebuildIndex()));
            });
        },
    };
}

export function updateIndexRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.updateIndex,
        desc: t.updateIndexDesc,
        render: (setting) => {
            setting.addButton(btn => {
                btn.setButtonText(t.updateBtn);
                btn.onClick(() => runIndexAction(ctx, btn, t.updateBtn, t.updatingBtn, () => ctx.plugin.updateIndex()));
            });
        },
    };
}

export function indexStatsRow(ctx: SettingsContext, visible?: Predicate): SettingDefinitionRender {
    return {
        name: t.indexStats,
        visible,
        render: (setting) => {
            const stats = setting.settingEl.createDiv({ cls: "vault-curate-stats" });
            renderStatsInto(ctx, stats);
            ctx.setStatsRefresher(() => renderStatsInto(ctx, stats));
            return () => {
                ctx.setStatsRefresher(null);
                stats.remove();
            };
        },
    };
}

// ── 015 D5: mobile-only rows ───────────────────────────────────

export function mobileGateStatusRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.indexStats,
        // 015 review W4: 'idle' just means "not loaded yet" (open the search
        // panel to load) — saying "no index yet" would be a lie. Only
        // loading/failed/too-large states earn a status line here.
        visible: () => !ctx.plugin.store && ctx.plugin.mobileGateState() !== "idle",
        render: (setting) => {
            setting.setDesc(ctx.plugin.mobileGateStatusText());
        },
    };
}

export function mobileReloadRow(ctx: SettingsContext): SettingDefinitionRender {
    return {
        name: t.mobileReloadIndex,
        render: (setting) => {
            setting.addButton(btn => {
                btn.setButtonText(t.mobileReloadIndex);
                btn.onClick(async () => {
                    await ctx.plugin.reloadMobileIndex().catch(() => { /* state renders below */ });
                    ctx.refresh(); // re-render card with fresh state
                });
            });
        },
    };
}
