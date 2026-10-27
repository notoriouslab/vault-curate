import { describe, expect, it, vi } from "vitest";
import { switchProvider, type ProviderSwitchHost } from "../src/settings/providerSwitch";

function host(opts: { reloadFails?: boolean; saveFailsAfter?: number } = {}) {
    let saves = 0;
    const h = {
        settings: { embeddingProvider: "wasm" as ProviderSwitchHost["settings"]["embeddingProvider"] },
        saveSettings: vi.fn(async () => {
            saves++;
            if (opts.saveFailsAfter !== undefined && saves > opts.saveFailsAfter) throw new Error("disk");
        }),
        reload: vi.fn(async () => { if (opts.reloadFails) throw new Error("boom"); }),
        refresh: vi.fn(),
        rebuild: vi.fn(async () => { /* noop */ }),
    };
    return h;
}

describe("switchProvider (042 D6)", () => {
    it("a failed reload puts the old provider back", async () => {
        const h = host({ reloadFails: true });
        await switchProvider(h, "openai-compatible", "wasm");
        expect(h.settings.embeddingProvider).toBe("wasm");
        expect(h.saveSettings).toHaveBeenCalledTimes(2);
        expect(h.refresh).toHaveBeenCalledTimes(1);
        expect(h.rebuild).not.toHaveBeenCalled();
    });

    it("never rejects, even when the rollback save fails", async () => {
        const h = host({ reloadFails: true, saveFailsAfter: 1 });
        await expect(switchProvider(h, "ollama", "wasm")).resolves.toBeUndefined();
    });

    it("never rejects when the first save fails", async () => {
        const h = host({ saveFailsAfter: 0 });
        await expect(switchProvider(h, "ollama", "wasm")).resolves.toBeUndefined();
        expect(h.reload).not.toHaveBeenCalled();
        expect(h.rebuild).not.toHaveBeenCalled();
    });

    it("a successful switch refreshes and rebuilds", async () => {
        const h = host();
        await switchProvider(h, "ollama", "wasm");
        expect(h.settings.embeddingProvider).toBe("ollama");
        expect(h.saveSettings).toHaveBeenCalledTimes(1);
        expect(h.refresh).toHaveBeenCalledTimes(1);
        expect(h.rebuild).toHaveBeenCalledTimes(1);
    });
});
