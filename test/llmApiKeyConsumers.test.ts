import { afterEach, describe, expect, it, vi } from "vitest";
import { Setting } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";
import type { SettingsContext } from "../src/settings/types";
import { DEFAULT_SETTINGS } from "../src/types";
import type { VaultSearchSettings } from "../src/types";

vi.mock("obsidian", () => import("./setup/obsidianSettingStub"));

const { requestLlmJson, checkLLMReachable, fetchOllamaModels } = vi.hoisted(() => ({
    requestLlmJson: vi.fn(),
    checkLLMReachable: vi.fn(),
    fetchOllamaModels: vi.fn(),
}));
vi.mock("../src/utils", async (orig) => ({
    ...(await orig<object>()),
    requestLlmJson,
    checkLLMReachable,
    fetchOllamaModels,
}));
vi.mock("../src/clustering", () => ({
    clusterEmbeddings: () => [{ label: 0, noteIndices: [0] }, { label: 1, noteIndices: [1] }],
    shouldFallbackToFlat: () => false,
}));

import { DescriptionGenerator } from "../src/description-generator";
import { generateMocGrouped } from "../src/moc-generator";
import type { NoteForMoc } from "../src/moc-generator";
import { llmEndpointRow, llmModelRow } from "../src/settings/rowsAICuration";
import { embeddingModelRow } from "../src/settings/rowsQuickSetup";

// The endpoint row uses Obsidian's empty()/setText(), which happy-dom lacks.
const proto = HTMLElement.prototype as unknown as { empty?: () => void; setText?: (s: string) => void };
proto.empty ??= function (this: HTMLElement) { this.textContent = ""; };
proto.setText ??= function (this: HTMLElement, s: string) { this.textContent = s; };

const SEPARATE = { apiKey: "emb-key", llmApiKey: "llm-key", llmUrl: "http://llm:8080" };

function settingsWith(overrides: Partial<VaultSearchSettings>): VaultSearchSettings {
    return { ...DEFAULT_SETTINGS, enableAICuration: true, ...overrides };
}

function generator(settings: VaultSearchSettings) {
    const plugin = { settings, app: {}, recordSelfWrite: () => {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new DescriptionGenerator(plugin as any) as any;
}

function mocNote(path: string): NoteForMoc {
    return { path, title: path, description: "", score: 1, embedding: [1, 0], tier: "hot", tags: [] };
}

function ctxFor(settings: VaultSearchSettings): SettingsContext {
    return {
        plugin: { settings, saveSettings: vi.fn(async () => { /* noop */ }) },
        refresh: vi.fn(),
        refreshPredicates: vi.fn(),
        onServerChange: () => () => { /* nothing registered */ },
        serverChanged: vi.fn(),
    } as unknown as SettingsContext;
}

function render(def: SettingDefinitionRender) {
    const setting = new Setting(document.createElement("div"));
    (def.render as (s: Setting) => unknown)(setting);
    return setting;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Every key the three AI curation request paths send for these settings. */
async function sentKeys(settings: VaultSearchSettings): Promise<string[]> {
    checkLLMReachable.mockResolvedValue({ reachable: true });
    requestLlmJson.mockResolvedValue({ description: "d", title: "t", intro: "i" });
    const g = generator(settings);
    await g.llmReachable();
    await g.callLLM("http://llm:8080", "m", "title", "body");
    await generateMocGrouped({ notes: [mocNote("a.md"), mocNote("b.md")], query: "q", settings });
    return [
        ...checkLLMReachable.mock.calls.map(([cfg]) => (cfg as { apiKey: string }).apiKey),
        ...requestLlmJson.mock.calls.map(([cfg]) => (cfg as { apiKey: string }).apiKey),
    ];
}

afterEach(() => {
    requestLlmJson.mockReset();
    checkLLMReachable.mockReset();
    fetchOllamaModels.mockReset();
});

describe("AI curation sends its own key (041 D5)", () => {
    it("pre-flight, description and MOC naming all send the AI curation key", async () => {
        // 1 pre-flight + 1 description + 2 cluster namings
        expect(await sentKeys(settingsWith(SEPARATE))).toEqual(["llm-key", "llm-key", "llm-key", "llm-key"]);
    });

    it("a shared server with no AI curation key reuses the embedding key", async () => {
        const keys = await sentKeys(settingsWith({ ...SEPARATE, llmApiKey: "", llmUrl: "" }));
        expect(keys).toEqual(["emb-key", "emb-key", "emb-key", "emb-key"]);
    });

    it("a separate server with no AI curation key gets no key", async () => {
        expect(await sentKeys(settingsWith({ ...SEPARATE, llmApiKey: "" }))).toEqual(["", "", "", ""]);
    });

    it("the LLM model list sends the AI curation key, the embedding list the embedding key", async () => {
        fetchOllamaModels.mockResolvedValue([]);
        const settings = settingsWith({ ...SEPARATE, embeddingProvider: "ollama" });
        render(llmModelRow(ctxFor(settings), () => true));
        render(embeddingModelRow(ctxFor(settings), () => true));
        await flush();
        expect(fetchOllamaModels.mock.calls.map((c) => c[2])).toEqual(["llm-key", "emb-key"]);
    });

    it("the endpoint status probes with the AI curation key", async () => {
        checkLLMReachable.mockResolvedValue({ reachable: true });
        render(llmEndpointRow(ctxFor(settingsWith(SEPARATE)), () => true));
        await flush();
        expect(checkLLMReachable).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "llm-key" }));
    });
});
