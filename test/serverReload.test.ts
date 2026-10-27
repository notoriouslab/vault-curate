import { afterEach, describe, expect, it, vi } from "vitest";
import { Setting } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";
import type { SettingsContext } from "../src/settings/types";
import { DEFAULT_SETTINGS } from "../src/types";
import type { OllamaModel } from "../src/utils";
import { t } from "../src/i18n";

vi.mock("obsidian", () => import("./setup/obsidianSettingStub"));

const { fetchOllamaModels, checkLLMReachable } = vi.hoisted(() => ({
    fetchOllamaModels: vi.fn(),
    checkLLMReachable: vi.fn(),
}));
vi.mock("../src/utils", async (orig) => ({
    ...(await orig<object>()),
    fetchOllamaModels,
    checkLLMReachable,
}));

import { llmEndpointRow, llmModelRow, llmUrlRow } from "../src/settings/rowsAICuration";
import { apiKeyRow, ollamaUrlRow } from "../src/settings/rowsQuickSetup";
import { SERVER_RELOAD_DELAY_MS } from "../src/settings/rowHelpers";
import { VaultSearchSettingTab } from "../src/settings";
import { buildDesktopDefinitions } from "../src/settings/definitions";

// The endpoint row uses Obsidian's empty()/setText(), which happy-dom lacks.
const proto = HTMLElement.prototype as unknown as { empty?: () => void; setText?: (s: string) => void };
proto.empty ??= function (this: HTMLElement) { this.textContent = ""; };
proto.setText ??= function (this: HTMLElement, s: string) { this.textContent = s; };

function model(name: string): OllamaModel {
    return { name, sizeGB: 0, isEmbedding: false, kind: "other", source: "heuristic" } as OllamaModel;
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A ctx whose server-change registry is the real tab's. */
function makeCtx(overrides: Record<string, unknown> = {}) {
    const tab = Object.create(VaultSearchSettingTab.prototype) as VaultSearchSettingTab;
    (tab as unknown as { serverListeners: Set<() => void> }).serverListeners = new Set();
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, enableAICuration: true, ...overrides },
        saveSettings: vi.fn(async () => { /* noop */ }),
        refreshMobileProvider: vi.fn(),
    };
    const ctx = {
        plugin,
        refresh: vi.fn(),
        refreshPredicates: vi.fn(),
        onServerChange: (cb: () => void) => tab.onServerChange(cb),
        serverChanged: vi.fn(() => tab.serverChanged()),
    } as unknown as SettingsContext & { serverChanged: ReturnType<typeof vi.fn> };
    return { ctx, plugin };
}

function render(def: SettingDefinitionRender) {
    const setting = new Setting(document.createElement("div"));
    const cleanup = (def.render as (s: Setting) => (() => void) | void)(setting);
    return { setting, cleanup: cleanup ?? (() => { /* none */ }) };
}

function optionValues(setting: Setting): string[] {
    return [...setting.controlEl.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value);
}

afterEach(() => {
    vi.useRealTimers();
    fetchOllamaModels.mockReset();
    checkLLMReachable.mockReset();
});

describe("server address edits reload in place (#19 follow-up)", () => {
    it("the LLM model list follows the new address and keeps the picked model", async () => {
        const { ctx, plugin } = makeCtx({ apiFormat: "openai", llmUrl: "http://localhost:11434/v1", llmModel: "gemma3:4b" });
        fetchOllamaModels.mockResolvedValueOnce([model("gemma3:4b"), model("qwen3:1.7b")]);
        const { setting, cleanup } = render(llmModelRow(ctx, () => true));
        await flush();
        expect(optionValues(setting)).toEqual(["", "gemma3:4b", "qwen3:1.7b"]);

        plugin.settings.apiFormat = "ollama";
        plugin.settings.llmUrl = "http://localhost:11434";
        fetchOllamaModels.mockResolvedValueOnce([model("gemma3:4b"), model("qwen3.8:27b-mlx")]);
        ctx.serverChanged();
        await flush();

        expect(fetchOllamaModels).toHaveBeenLastCalledWith("http://localhost:11434", "ollama", plugin.settings.apiKey);
        expect(optionValues(setting)).toEqual(["", "gemma3:4b", "qwen3.8:27b-mlx"]);
        expect((setting.controlEl.querySelector("select") as HTMLSelectElement).value).toBe("gemma3:4b");
        cleanup();
    });

    it("an unreachable new address drops the old list instead of keeping it", async () => {
        const { ctx } = makeCtx({ llmModel: "gemma3:4b" });
        fetchOllamaModels.mockResolvedValueOnce([model("gemma3:4b"), model("qwen3:1.7b")]);
        const { setting, cleanup } = render(llmModelRow(ctx, () => true));
        await flush();

        fetchOllamaModels.mockResolvedValueOnce([]);
        ctx.serverChanged();
        await flush();

        expect(optionValues(setting)).toEqual(["", "gemma3:4b"]);
        expect(setting.controlEl.querySelector('option[value=""]')!.textContent).toBe(t.modelListUnavailable);
        cleanup();
    });

    it("drops a late answer from the previous address", async () => {
        const { ctx } = makeCtx({ llmModel: "" });
        const slow = deferred<OllamaModel[]>();
        fetchOllamaModels.mockReturnValueOnce(slow.promise);
        const { setting, cleanup } = render(llmModelRow(ctx, () => true));

        fetchOllamaModels.mockResolvedValueOnce([model("new-model")]);
        ctx.serverChanged();
        await flush();
        slow.resolve([model("old-model")]);
        await flush();

        expect(optionValues(setting)).toEqual(["", "new-model"]);
        cleanup();
    });

    it("a removed row stops listening", async () => {
        const { ctx } = makeCtx();
        fetchOllamaModels.mockResolvedValue([]);
        const { cleanup } = render(llmModelRow(ctx, () => true));
        await flush();
        cleanup();
        ctx.serverChanged();
        await flush();
        expect(fetchOllamaModels).toHaveBeenCalledTimes(1);
    });

    it("a hidden model row neither fetches nor listens", async () => {
        const { ctx } = makeCtx();
        render(llmModelRow(ctx, () => false));
        ctx.serverChanged();
        await flush();
        expect(fetchOllamaModels).not.toHaveBeenCalled();
    });

    it("the endpoint probe re-runs and ignores a stale answer", async () => {
        const { ctx } = makeCtx({ apiFormat: "ollama", llmUrl: "http://localhost:11434/v1" });
        const stale = deferred<{ reachable: boolean; reason?: string }>();
        checkLLMReachable.mockReturnValueOnce(stale.promise);
        const { setting, cleanup } = render(llmEndpointRow(ctx, () => true));

        checkLLMReachable.mockResolvedValueOnce({ reachable: true });
        ctx.serverChanged();
        await flush();
        stale.resolve({ reachable: false, reason: "HTTP 404" });
        await flush();

        expect(checkLLMReachable).toHaveBeenCalledTimes(2);
        expect(setting.descEl.querySelector(".vault-curate-endpoint-status")!.textContent).toBe(t.llmEndpointReachable);
        cleanup();
    });

    it.each([
        ["AI curation server", (ctx: SettingsContext) => llmUrlRow(ctx, () => true)],
        ["embedding server", (ctx: SettingsContext) => ollamaUrlRow(ctx)],
        ["API key", (ctx: SettingsContext) => apiKeyRow(ctx)],
    ])("the %s field reloads once typing pauses, not per keystroke", async (_label, build) => {
        vi.useFakeTimers();
        const { ctx } = makeCtx();
        let text!: { emit(v: string): unknown };
        const setting = new Setting(document.createElement("div")) as Setting & { addText: Setting["addText"] };
        const orig = setting.addText.bind(setting);
        setting.addText = ((cb: (c: never) => unknown) => orig((c: never) => { text = c as never; return cb(c); })) as never;
        const cleanup = (build(ctx).render as (s: Setting) => () => void)(setting);

        await text.emit("http://localhost:1");
        await text.emit("http://localhost:11");
        await text.emit("http://localhost:11434");
        expect(ctx.serverChanged).not.toHaveBeenCalled();
        vi.advanceTimersByTime(SERVER_RELOAD_DELAY_MS);
        expect(ctx.serverChanged).toHaveBeenCalledTimes(1);
        expect(ctx.refresh).not.toHaveBeenCalled();

        await text.emit("http://localhost:11435");
        cleanup();
        vi.advanceTimersByTime(SERVER_RELOAD_DELAY_MS);
        expect(ctx.serverChanged).toHaveBeenCalledTimes(1);
    });

    it("the http-with-key warning appears when the key is typed after the address", async () => {
        const { ctx, plugin } = makeCtx({ llmUrl: "http://192.168.1.20:11434", apiKey: "" });
        const { setting, cleanup } = render(llmUrlRow(ctx, () => true));
        expect(setting.settingEl.querySelector(".vault-curate-http-warn")).toBeNull();

        plugin.settings.apiKey = "sk-test";
        ctx.serverChanged();
        expect(setting.settingEl.querySelector(".vault-curate-http-warn")).not.toBeNull();
        cleanup();
    });
});

describe("API key row visibility (1.14.2)", () => {
    const keyRowVisible = (overrides: Record<string, unknown>) => {
        const { ctx } = makeCtx(overrides);
        const groups = buildDesktopDefinitions(ctx) as unknown as Array<{ items?: Array<{ name?: string; visible?: () => boolean }> }>;
        const row = groups.flatMap((g) => g.items ?? []).find((i) => i.name === t.apiKeyLabel)!;
        return row.visible ? row.visible() : true;
    };

    it.each([
        [{ embeddingProvider: "wasm", enableAICuration: true }, true],
        [{ embeddingProvider: "wasm", enableAICuration: false }, false],
        [{ embeddingProvider: "ollama", enableAICuration: false }, true],
        [{ embeddingProvider: "openai-compatible", enableAICuration: true }, true],
    ])("%o -> %s", (overrides, expected) => {
        expect(keyRowVisible(overrides)).toBe(expected);
    });
});
