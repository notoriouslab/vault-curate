import { afterEach, describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", async (orig) => ({ ...(await orig<object>()), requestUrl }));

import { fetchOllamaModels } from "../src/utils";

type Req = { url: string; headers?: Record<string, string> };
const calls = () => requestUrl.mock.calls.map(([r]) => r as Req);

afterEach(() => requestUrl.mockReset());

describe("fetchOllamaModels sends the API key (1.14.2)", () => {
    it("OpenAI-compatible /v1/models carries the bearer key", async () => {
        requestUrl.mockResolvedValue({ status: 200, json: { data: [{ id: "gpt-4o-mini" }] } });
        const models = await fetchOllamaModels("https://api.openai.com/v1", "openai", "sk-test");
        expect(models.map((m) => m.name)).toEqual(["gpt-4o-mini"]);
        expect(calls()[0].url).toBe("https://api.openai.com/v1/models");
        expect(calls()[0].headers?.Authorization).toBe("Bearer sk-test");
    });

    it("Ollama /api/tags and the /api/show fallback carry it too", async () => {
        requestUrl
            .mockResolvedValueOnce({ status: 200, json: { models: [{ name: "gemma3:4b", size: 1e9 }] } })
            .mockResolvedValueOnce({ status: 200, json: { capabilities: ["completion"] } });
        await fetchOllamaModels("http://gpu-box:11434", "ollama", "proxy-key");
        expect(calls().map((c) => c.url)).toEqual(["http://gpu-box:11434/api/tags", "http://gpu-box:11434/api/show"]);
        for (const c of calls()) expect(c.headers?.Authorization).toBe("Bearer proxy-key");
    });

    it("no key, no Authorization header", async () => {
        requestUrl.mockResolvedValue({ status: 200, json: { data: [] } });
        await fetchOllamaModels("http://localhost:11434/v1", "openai");
        expect(calls()[0].headers?.Authorization).toBeUndefined();
    });
});
