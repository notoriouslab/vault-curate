import { describe, expect, it, vi } from "vitest";
import type { SettingDefinitionItem } from "obsidian";
import { buildDesktopDefinitions, buildMobileDefinitions } from "../src/settings/definitions";
import type { SettingsContext } from "../src/settings/types";
import { DEFAULT_SETTINGS } from "../src/types";
import { t } from "../src/i18n";

vi.mock("obsidian", () => import("./setup/obsidianSettingStub"));

type Leaf = { name: string } & Record<string, unknown>;

/** Recursively collect the leaf definitions (everything that is not a group/list/page). */
function flatten(items: SettingDefinitionItem[]): Leaf[] {
    const out: Leaf[] = [];
    for (const item of items) {
        const node = item as Record<string, unknown> & { name?: string };
        const type = node.type as string | undefined;
        if (type === "group" || type === "list" || type === "page") {
            out.push(...flatten((node.items ?? []) as SettingDefinitionItem[]));
        } else {
            out.push(node as Leaf);
        }
    }
    return out;
}

function makeCtx(settingsOverrides: Record<string, unknown> = {}) {
    const saveSettings = vi.fn(async () => { /* noop */ });
    const refresh = vi.fn();
    const refreshPredicates = vi.fn();
    const confirmProviderSwitch = vi.fn(async () => true);
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, ...settingsOverrides },
        store: null,
        indexer: null,
        saveSettings,
        reloadBackends: vi.fn(async () => { /* noop */ }),
        rebuildIndex: vi.fn(async () => { /* noop */ }),
        updateIndex: vi.fn(async () => { /* noop */ }),
        reloadMobileIndex: vi.fn(async () => { /* noop */ }),
        refreshMobileProvider: vi.fn(),
        showOnboardingModal: vi.fn(),
        mobileGateState: vi.fn(() => "idle"),
        mobileGateStatusText: vi.fn(() => ""),
        tierResolver: vi.fn(() => () => "hot"),
    };
    const ctx = {
        app: {},
        plugin,
        refresh,
        refreshPredicates,
        confirmProviderSwitch,
        setStatsRefresher: vi.fn(),
        refreshStats: vi.fn(),
    } as unknown as SettingsContext;
    return { ctx, plugin, saveSettings, refresh, refreshPredicates, confirmProviderSwitch };
}

describe("setting definitions", () => {
    it("lists every desktop leaf in the current display() order", () => {
        const { ctx } = makeCtx();
        const names = flatten(buildDesktopDefinitions(ctx)).map(i => i.name);
        expect(names).toEqual([
            t.embeddingProvider,
            t.embeddingProviderBuiltin,
            t.ollamaUrl,
            t.apiKeyLabel,
            t.embeddingModel,
            t.excludePatterns,
            t.enableAICuration,
            t.apiFormat,
            t.llmUrlName,
            t.llmModel,
            t.llmEndpointHeading,
            t.rerunOnboarding,
            t.topResults,
            t.minScore,
            t.settingCanvasFolder,
            t.settingRelatedSection,
            t.settingPromoteBidirectional,
            t.dismissedHeading,
            t.hotDays,
            t.searchScope,
            t.chunkSize,
            t.chunkOverlap,
            t.synonymsLabel,
            t.autoIndex,
            t.rebuildIndex,
            t.updateIndex,
            t.indexStats,
        ]);
        expect(names.length).toBe(27); // 034: "Max embed characters" row retired
    });

    it("uses no control definitions", () => {
        const { ctx } = makeCtx();
        const leaves = [
            ...flatten(buildDesktopDefinitions(ctx)),
            ...flatten(buildMobileDefinitions(ctx)),
        ];
        for (const leaf of leaves) {
            expect("control" in leaf).toBe(false);
        }
    });

    it("puts the advanced rows on a page holding the actions and stats groups", () => {
        const { ctx } = makeCtx();
        const top = buildDesktopDefinitions(ctx) as Array<Record<string, unknown>>;
        const advanced = top[2];
        expect(advanced.type).toBe("page");
        expect(advanced.name).toBe(t.sectionAdvanced);
        const headings = (advanced.items as Array<Record<string, unknown>>)
            .filter(i => i.type === "group")
            .map(i => i.heading);
        expect(headings).toEqual([t.actions, t.indexStats]);
    });

    it("omits the desktop-only rows from the mobile list", () => {
        const { ctx } = makeCtx();
        const leaves = flatten(buildMobileDefinitions(ctx));
        const names = leaves.map(i => i.name);
        // The provider picker is desktop-only; mobile only carries the
        // endpoint fields (the loopback notice reuses the same label).
        expect(leaves.filter(i => i.name === t.embeddingProvider && "render" in i)).toEqual([]);
        expect(names).not.toContain(t.rebuildIndex);
        expect(names).not.toContain(t.updateIndex);
        expect(names).not.toContain(t.chunkSize);
        expect(names).not.toContain(t.chunkOverlap);
        expect(names).toContain(t.mobileReloadIndex);
    });

    it("builds both lists without a backend and without touching the context", () => {
        const { ctx, saveSettings, refresh, refreshPredicates, confirmProviderSwitch } = makeCtx();
        expect(() => buildDesktopDefinitions(ctx)).not.toThrow();
        expect(() => buildMobileDefinitions(ctx)).not.toThrow();
        expect(refresh).not.toHaveBeenCalled();
        expect(refreshPredicates).not.toHaveBeenCalled();
        expect(confirmProviderSwitch).not.toHaveBeenCalled();
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it("gates conditional rows behind visible predicates", () => {
        const wasm = makeCtx({ embeddingProvider: "wasm" });
        const builtinNote = flatten(buildDesktopDefinitions(wasm.ctx))
            .find(i => i.name === t.embeddingProviderBuiltin)!;
        expect((builtinNote.visible as () => boolean)()).toBe(true);

        const ollama = makeCtx({ embeddingProvider: "ollama" });
        const builtinNoteOllama = flatten(buildDesktopDefinitions(ollama.ctx))
            .find(i => i.name === t.embeddingProviderBuiltin)!;
        expect((builtinNoteOllama.visible as () => boolean)()).toBe(false);

        const curationOff = makeCtx({ enableAICuration: false });
        const apiFormat = flatten(buildDesktopDefinitions(curationOff.ctx))
            .find(i => i.name === t.apiFormat)!;
        expect((apiFormat.visible as () => boolean)()).toBe(false);
    });
});
