// Declarative setting definitions — the single source of truth for the
// settings tab. Obsidian 1.13+ renders them itself (and indexes name/desc
// for the settings search); older versions go through renderLegacy() from
// display().
//
// Hard constraint (032 spike S1): the list is built once, when the tab is
// registered and the backend is still starting, and is rebuilt only on
// update(). Nothing here may read plugin.store / plugin.indexer or call a
// context method while building — conditional rows carry a `visible`
// predicate and every read of live state happens inside `render`.
//
// The row factories live in the rows*.ts modules beside this one; this file
// only assembles them into the desktop and mobile lists.

import type { SettingDefinitionEmpty, SettingDefinitionItem } from "obsidian";
import type { SettingsContext } from "./types";
import type { Predicate } from "./rowHelpers";
import {
    apiKeyRow,
    embeddingModelRow,
    excludePatternsRow,
    ollamaUrlRow,
    providerRow,
} from "./rowsQuickSetup";
import {
    apiFormatRow,
    enableAICurationRow,
    llmEndpointRow,
    llmModelRow,
    llmUrlRow,
    rerunOnboardingRow,
} from "./rowsAICuration";
import {
    autoIndexRow,
    canvasFolderRow,
    chunkOverlapRow,
    chunkSizeRow,
    dismissedRow,
    hotDaysRow,
    indexStatsRow,
    maxEmbedCharsRow,
    minScoreRow,
    mobileGateStatusRow,
    mobileReloadRow,
    promoteBidirectionalRow,
    rebuildIndexRow,
    relatedSectionRow,
    searchScopeRow,
    synonymsRow,
    topResultsRow,
    updateIndexRow,
} from "./rowsAdvanced";
import { isLoopbackHost } from "../utils";
import { t } from "../i18n";

export function buildDesktopDefinitions(ctx: SettingsContext): SettingDefinitionItem[] {
    const external: Predicate = () => ctx.plugin.settings.embeddingProvider !== "wasm";
    const curation: Predicate = () => ctx.plugin.settings.enableAICuration;
    const builtinNote: SettingDefinitionEmpty = {
        name: t.embeddingProviderBuiltin,
        desc: t.builtinModelNote,
        visible: () => ctx.plugin.settings.embeddingProvider === "wasm",
    };
    return [
        {
            // No heading: Obsidian's plugin guidelines keep the general
            // settings at the top without one, and 1.13 hides a leading
            // group heading anyway (dogfood 2026-09-23). Legacy matches.
            type: "group",
            items: [
                providerRow(ctx),
                builtinNote,
                ollamaUrlRow(ctx, external),
                apiKeyRow(ctx, external),
                embeddingModelRow(ctx, external),
                excludePatternsRow(ctx),
            ],
        },
        {
            type: "group",
            heading: t.sectionAICuration,
            items: [
                enableAICurationRow(ctx),
                apiFormatRow(ctx, curation),
                llmUrlRow(ctx, curation),
                llmModelRow(ctx, curation),
                llmEndpointRow(ctx, curation),
                rerunOnboardingRow(ctx),
            ],
        },
        {
            type: "page",
            name: t.sectionAdvanced,
            items: [
                topResultsRow(ctx),
                minScoreRow(ctx),
                canvasFolderRow(ctx),
                relatedSectionRow(ctx),
                promoteBidirectionalRow(ctx),
                dismissedRow(ctx),
                maxEmbedCharsRow(ctx),
                hotDaysRow(ctx),
                searchScopeRow(ctx),
                chunkSizeRow(ctx),
                chunkOverlapRow(ctx),
                synonymsRow(ctx),
                autoIndexRow(ctx),
                {
                    type: "group",
                    heading: t.actions,
                    items: [rebuildIndexRow(ctx), updateIndexRow(ctx)],
                },
                {
                    type: "group",
                    heading: t.indexStats,
                    visible: () => !!ctx.plugin.store,
                    items: [indexStatsRow(ctx)],
                },
            ],
        },
    ];
}

/** 015 D5: only what works on mobile — index status card (+ reload), remote
 *  endpoint for layer-2 semantic search, query params, dismissed manager. */
export function buildMobileDefinitions(ctx: SettingsContext): SettingDefinitionItem[] {
    const maintainedNote: SettingDefinitionEmpty = {
        name: t.indexStats,
        desc: t.mobileIndexMaintainedByDesktop,
    };
    const loopbackNote: SettingDefinitionEmpty = {
        name: t.embeddingProvider,
        desc: t.mobileLoopbackWarning,
        visible: () => isLoopbackHost(ctx.plugin.settings.ollamaUrl),
    };
    return [
        {
            type: "group",
            heading: t.indexStats,
            items: [
                maintainedNote,
                indexStatsRow(ctx, () => !!ctx.plugin.store),
                mobileGateStatusRow(ctx),
                mobileReloadRow(ctx),
            ],
        },
        {
            type: "group",
            heading: t.embeddingProvider,
            items: [
                loopbackNote,
                ollamaUrlRow(ctx),
                apiKeyRow(ctx),
                embeddingModelRow(ctx),
            ],
        },
        topResultsRow(ctx),
        minScoreRow(ctx),
        searchScopeRow(ctx),
        dismissedRow(ctx),
    ];
}
