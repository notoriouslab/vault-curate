import { beforeEach, describe, expect, it, vi } from "vitest";

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));
vi.mock("obsidian", async (orig) => {
    const real = await orig<Record<string, unknown>>();
    class Notice {
        constructor(msg?: unknown) { notices.push(String(msg)); }
        setMessage(): this { return this; }
        hide(): void { /* noop */ }
    }
    return { ...real, Notice };
});

import { applyOnboardingChoice, type OnboardingChoice } from "../src/ui/OnboardingModal";
import { DEFAULT_SETTINGS, type VaultSearchSettings } from "../src/types";
import { t } from "../src/i18n";

function fakePlugin(over: Partial<VaultSearchSettings> = {}, opts: { reloadFails?: boolean; noStore?: boolean } = {}) {
    const settings: VaultSearchSettings = {
        ...DEFAULT_SETTINGS, dismissedPairs: {}, dismissedNotes: {}, ...over,
    };
    return {
        settings,
        saveSettings: vi.fn(async () => { /* noop */ }),
        reloadEmbedding: vi.fn(async () => { if (opts.reloadFails) throw new Error("boom"); }),
        rebuildIndex: vi.fn(async () => { /* noop */ }),
        store: opts.noStore ? undefined : { setMeta: vi.fn() },
    };
}

type Fake = ReturnType<typeof fakePlugin>;
const apply = (p: Fake, c: OnboardingChoice) =>
    applyOnboardingChoice(p as unknown as Parameters<typeof applyOnboardingChoice>[0], c);

const choice = (over: Partial<OnboardingChoice> = {}): OnboardingChoice => ({
    provider: "wasm", aiCuration: "no", indexNow: true, dismissed: false, ...over,
});

const providers: OnboardingChoice[] = [
    choice({ provider: "wasm" }),
    choice({ provider: "ollama", ollamaModel: "nomic-embed-text" }),
    choice({ provider: "openai-compatible", openaiUrl: "https://api.example.com/v1", openaiModel: "emb-1", openaiKey: "sk-x" }),
];

beforeEach(() => { notices.length = 0; });

describe("applyOnboardingChoice: dismiss changes nothing (042 D2)", () => {
    for (const c of providers) {
        it(`${c.provider}: only onboardingDone flips`, async () => {
            const p = fakePlugin();
            const before = structuredClone(p.settings);
            await apply(p, { ...c, dismissed: true, indexNow: false });
            expect(p.settings).toEqual({ ...before, onboardingDone: true });
            expect(p.saveSettings).toHaveBeenCalledTimes(1);
            expect(p.reloadEmbedding).not.toHaveBeenCalled();
            expect(p.rebuildIndex).not.toHaveBeenCalled();
            expect(p.store?.setMeta).not.toHaveBeenCalled();
        });
    }

    it("works without a store", async () => {
        const p = fakePlugin({}, { noStore: true });
        await expect(apply(p, choice({ dismissed: true }))).resolves.toBeUndefined();
        expect(p.settings.onboardingDone).toBe(true);
    });
});

describe("applyOnboardingChoice: only over default settings (042 D3)", () => {
    const changed: Partial<VaultSearchSettings>[] = [
        { embeddingProvider: "ollama" },
        { ollamaUrl: "http://gpu-box:11434" },
        { ollamaModel: "other-model" },
        { apiKey: "k" },
        { apiFormat: "openai" },
        { llmUrl: "http://lm:1234/v1" },
        { llmApiKey: "k2" },
        { enableAICuration: true },
    ];
    for (const over of changed) {
        it(`steps aside when ${Object.keys(over)[0]} was changed`, async () => {
            const p = fakePlugin(over);
            const before = structuredClone(p.settings);
            await apply(p, providers[2]);
            expect(p.settings).toEqual({ ...before, onboardingDone: true });
            expect(p.reloadEmbedding).not.toHaveBeenCalled();
            expect(p.rebuildIndex).not.toHaveBeenCalled();
            expect(notices).toEqual([t.onboardingSettingsChanged]);
        });
    }

    it("applies each provider over defaults, as 1.15.0 did", async () => {
        const wasm = fakePlugin();
        await apply(wasm, providers[0]);
        expect(wasm.settings).toMatchObject({ embeddingProvider: "wasm", onboardingDone: true });

        const ollama = fakePlugin();
        await apply(ollama, providers[1]);
        expect(ollama.settings).toMatchObject({
            embeddingProvider: "ollama", apiFormat: "ollama", ollamaModel: "nomic-embed-text", onboardingDone: true,
        });

        const openai = fakePlugin();
        await apply(openai, providers[2]);
        expect(openai.settings).toMatchObject({
            embeddingProvider: "openai-compatible", apiFormat: "openai",
            ollamaUrl: "https://api.example.com/v1", ollamaModel: "emb-1", apiKey: "sk-x", onboardingDone: true,
        });
        for (const p of [wasm, ollama, openai]) {
            expect(p.reloadEmbedding).toHaveBeenCalledTimes(1);
            expect(p.rebuildIndex).toHaveBeenCalledTimes(1);
            expect(p.store?.setMeta).not.toHaveBeenCalled();
        }
    });

    it("a failed backend reload keeps onboardingDone and writes no meta", async () => {
        const p = fakePlugin({}, { reloadFails: true });
        await apply(p, providers[0]);
        expect(p.settings.onboardingDone).toBe(true);
        expect(p.rebuildIndex).not.toHaveBeenCalled();
        expect(p.store?.setMeta).not.toHaveBeenCalled();
    });
});

describe("applyOnboardingChoice: pick-a-model hint (042 D8)", () => {
    const hint = t.onboardingPickLlmModel(DEFAULT_SETTINGS.llmModel, t.llmModel);

    it("shows for OpenAI-compatible with AI curation on", async () => {
        const p = fakePlugin();
        await apply(p, { ...providers[2], aiCuration: "yes" });
        expect(notices).toEqual([hint]);
        expect(hint).toContain(DEFAULT_SETTINGS.llmModel);
        expect(hint).toContain(t.llmModel);
    });

    it("stays quiet for every other outcome", async () => {
        const cases: [Partial<VaultSearchSettings>, OnboardingChoice, { reloadFails?: boolean }][] = [
            [{}, { ...providers[2], aiCuration: "no" }, {}],
            [{}, { ...providers[0], aiCuration: "yes" }, {}],
            [{}, { ...providers[1], aiCuration: "yes" }, {}],
            [{}, { ...providers[2], aiCuration: "yes" }, { reloadFails: true }],
            [{ apiKey: "k" }, { ...providers[2], aiCuration: "yes" }, {}],
            [{}, { ...providers[2], aiCuration: "yes", dismissed: true }, {}],
        ];
        for (const [over, c, opts] of cases) {
            notices.length = 0;
            await apply(fakePlugin(over, opts), c);
            expect(notices).not.toContain(hint);
        }
    });
});
