import { describe, expect, it, vi } from "vitest";
import type { SettingDefinitionItem } from "obsidian";
import { buildDesktopDefinitions, buildMobileDefinitions } from "../src/settings/definitions";
import type { SettingsContext } from "../src/settings/types";
import { DEFAULT_SETTINGS } from "../src/types";
import { t } from "../src/i18n";
import { Setting } from "obsidian";

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
            t.aiOutputLanguage,
            t.aiOutputLanguageCustomName,
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
        expect(names.length).toBe(29); // 034: "Max embed characters" row retired; 036: +2 AI output language rows
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
    it("shows the custom language row only for custom output with AI curation on (036)", () => {
        const visibleOf = (overrides: Record<string, unknown>) => {
            const { ctx } = makeCtx(overrides);
            const row = flatten(buildDesktopDefinitions(ctx)).find(i => i.name === t.aiOutputLanguageCustomName)!;
            return (row.visible as () => boolean)();
        };
        expect(visibleOf({ enableAICuration: true, aiOutputLanguage: "auto" })).toBe(false);
        expect(visibleOf({ enableAICuration: true, aiOutputLanguage: "custom" })).toBe(true);
        expect(visibleOf({ enableAICuration: false, aiOutputLanguage: "custom" })).toBe(false);
    });

    it("keeps the AI output language rows off the mobile list (036)", () => {
        const { ctx } = makeCtx();
        const names = flatten(buildMobileDefinitions(ctx)).map(i => i.name);
        expect(names).not.toContain(t.aiOutputLanguage);
        expect(names).not.toContain(t.aiOutputLanguageCustomName);
    });

    it("saves the output language and refreshes predicates only; the name field just saves (036)", async () => {
        type Emitter = { emit(val: string): unknown };
        const render = (leaf: Leaf): Emitter => {
            const setting = new Setting(document.createElement("div")) as Setting & Record<string, unknown>;
            let captured: Emitter | undefined;
            for (const method of ["addDropdown", "addText"] as const) {
                const orig = (setting[method] as (cb: (c: Emitter) => unknown) => unknown).bind(setting);
                setting[method] = (cb: (c: Emitter) => unknown) => orig((c: Emitter) => { captured = c; return cb(c); });
            }
            (leaf.render as (s: Setting) => void)(setting);
            return captured!;
        };
        const { ctx, plugin, saveSettings, refresh, refreshPredicates } = makeCtx({ enableAICuration: true });
        const leaves = flatten(buildDesktopDefinitions(ctx));
        const drop = render(leaves.find(i => i.name === t.aiOutputLanguage)!);

        await drop.emit("custom");
        expect(plugin.settings.aiOutputLanguage).toBe("custom");
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(refreshPredicates).toHaveBeenCalledTimes(1);

        await drop.emit("xx");
        expect(plugin.settings.aiOutputLanguage).toBe("auto");

        refresh.mockClear();
        refreshPredicates.mockClear();
        saveSettings.mockClear();
        const text = render(leaves.find(i => i.name === t.aiOutputLanguageCustomName)!);
        await text.emit("Français");
        expect(plugin.settings.aiOutputLanguageCustom).toBe("Français");
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(refreshPredicates).not.toHaveBeenCalled();
    });
});
