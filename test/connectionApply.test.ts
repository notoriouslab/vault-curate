import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    applyBeforeIndexJob, applyOnClose, connectionOf, connectionStale, serialize,
    type ConnectionHost,
} from "../src/utils/connectionApply";
import { DEFAULT_SETTINGS } from "../src/types";

function settings(over: Partial<typeof DEFAULT_SETTINGS> = {}) {
    return { ...DEFAULT_SETTINGS, embeddingProvider: "ollama" as const, ollamaUrl: "http://a:11434", apiKey: "k1", ...over };
}

function host(over: Partial<ConnectionHost> & { reloadFails?: boolean } = {}) {
    const s = over.settings ?? settings();
    const h = {
        mobile: false,
        settings: s,
        built: connectionOf(s),
        indexer: { indexing: false },
        reload: vi.fn(async () => { if (over.reloadFails) throw new Error("boom"); }),
        refreshMobile: vi.fn(),
        ...over,
    };
    return h;
}

const flush = () => new Promise((r) => window.setTimeout(r, 0));

describe("connectionStale (042 D4)", () => {
    it("an edited URL or key is stale; editing it back is not", () => {
        const s = settings();
        const built = connectionOf(s);
        expect(connectionStale({ ...s, ollamaUrl: "http://b:11434" }, built)).toBe(true);
        expect(connectionStale({ ...s, apiKey: "k2" }, built)).toBe(true);
        expect(connectionStale({ ...s, ollamaUrl: " http://a:11434 " }, built)).toBe(false);
        expect(connectionStale(s, built)).toBe(false);
    });

    it("the built-in model is never stale", () => {
        expect(connectionStale(settings({ embeddingProvider: "wasm", ollamaUrl: "x" }), { url: "", key: "" })).toBe(false);
    });

    it("a failed build still records what it tried", () => {
        const tried = connectionOf(settings({ ollamaUrl: "http://down:1" }));
        expect(connectionStale(settings({ ollamaUrl: "http://down:1" }), tried)).toBe(false);
        expect(connectionStale(settings({ ollamaUrl: "http://up:1" }), tried)).toBe(true);
    });
});

describe("applyOnClose (042 D4)", () => {
    let rejections = 0;
    const onRej = () => { rejections++; };
    beforeEach(() => { rejections = 0; process.on("unhandledRejection", onRej); });
    afterEach(() => { process.off("unhandledRejection", onRej); });

    const edited = () => settings({ ollamaUrl: "http://b:11434" });

    it("desktop, stale, idle → reloads once", () => {
        const h = host({ settings: edited(), built: connectionOf(settings()) });
        applyOnClose(h);
        expect(h.reload).toHaveBeenCalledTimes(1);
    });

    it("not stale, indexing, or no indexer → no reload", () => {
        const a = host();
        const b = host({ settings: edited(), built: connectionOf(settings()), indexer: { indexing: true } });
        const c = host({ settings: edited(), built: connectionOf(settings()), indexer: undefined });
        for (const h of [a, b, c]) applyOnClose(h);
        for (const h of [a, b, c]) expect(h.reload).not.toHaveBeenCalled();
    });

    it("a failed reload is not an unhandled rejection", async () => {
        const h = host({ settings: edited(), built: connectionOf(settings()), reloadFails: true });
        applyOnClose(h);
        await flush();
        await flush();
        expect(rejections).toBe(0);
    });

    it("mobile refreshes the provider instead", () => {
        const h = host({ mobile: true, settings: edited(), built: connectionOf(settings()) });
        applyOnClose(h);
        expect(h.refreshMobile).toHaveBeenCalledTimes(1);
        expect(h.reload).not.toHaveBeenCalled();
    });
});

describe("applyBeforeIndexJob (042 D4)", () => {
    const edited = () => settings({ apiKey: "k2" });

    it("stale → reloads, job may start", async () => {
        const h = host({ settings: edited(), built: connectionOf(settings()) });
        await expect(applyBeforeIndexJob(h)).resolves.toBe(true);
        expect(h.reload).toHaveBeenCalledTimes(1);
    });

    it("reload fails → job must not start", async () => {
        const h = host({ settings: edited(), built: connectionOf(settings()), reloadFails: true });
        await expect(applyBeforeIndexJob(h)).resolves.toBe(false);
    });

    it("not stale → no reload, job may start", async () => {
        const h = host();
        await expect(applyBeforeIndexJob(h)).resolves.toBe(true);
        expect(h.reload).not.toHaveBeenCalled();
    });
});

describe("serialize (042 D4)", () => {
    it("the second call starts only after the first settles", async () => {
        const order: string[] = [];
        let release!: () => void;
        let calls = 0;
        const run = serialize(async () => {
            const n = ++calls;
            order.push(`start${n}`);
            if (n === 1) await new Promise<void>((r) => { release = r; });
            order.push(`end${n}`);
        });
        const p1 = run();
        const p2 = run();
        await flush();
        expect(order).toEqual(["start1"]);
        release();
        await Promise.all([p1, p2]);
        expect(order).toEqual(["start1", "end1", "start2", "end2"]);
    });

    it("a failed call doesn't block the next; each caller sees its own outcome", async () => {
        let calls = 0;
        const run = serialize(async () => { if (++calls === 1) throw new Error("first"); });
        const p1 = run();
        const p2 = run();
        await expect(p1).rejects.toThrow("first");
        await expect(p2).resolves.toBeUndefined();
    });
});
