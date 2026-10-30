import { afterEach, describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", async (orig) => ({ ...(await orig<object>()), requestUrl }));

import { checkLLMReachable, fetchOllamaModels } from "../src/utils";

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

describe("JSON output support from /models (issue #19)", () => {
    it("marks models by supported_parameters and leaves unreported ones alone", async () => {
        requestUrl.mockResolvedValue({ status: 200, json: { data: [
            { id: "scaledown/summarize", supported_parameters: ["max_tokens"] },
            { id: "openai/gpt-4o-mini", supported_parameters: ["max_tokens", "response_format"] },
            { id: "x/structured", supported_parameters: ["structured_outputs"] },
            { id: "local-model" },
        ] } });
        const models = await fetchOllamaModels("https://openrouter.ai/api/v1", "openai");
        expect(models.map((m) => [m.name, m.jsonOutput])).toEqual([
            ["scaledown/summarize", false],
            ["openai/gpt-4o-mini", true],
            ["x/structured", true],
            ["local-model", undefined],
        ]);
    });
});

describe("checkLLMReachable reason (issue #19)", () => {
    it("carries the server's error message", async () => {
        requestUrl.mockResolvedValue({ status: 401, text: '{"error":{"message":"User not found.","code":401}}' });
        const r = await checkLLMReachable({ ollamaUrl: "https://openrouter.ai/api/v1", apiFormat: "openai", apiKey: "k" });
        expect(r.reachable).toBe(false);
        expect(r.reason).toBe("HTTP 401: User not found.");
    });

    it("falls back to the bare status on an empty body", async () => {
        requestUrl.mockResolvedValue({ status: 503, text: "" });
        const r = await checkLLMReachable({ ollamaUrl: "http://localhost:11434", apiFormat: "ollama", apiKey: "" });
        expect(r.reason).toBe("HTTP 503");
    });
});
