/**
 * EmbeddingProvider abstraction — see openspec/changes/004-vault-curate-rebrand/design.md D3.
 *
 * Three implementations:
 *   - WasmEmbeddingProvider     (worker + transformers.js + Xenova/bge-base-zh)
 *   - OllamaEmbeddingProvider   (HTTP /api/embed)
 *   - OpenAICompatibleProvider  (HTTP /v1/embeddings)
 *
 * Lifecycle:
 *   1. const p = ProviderRegistry.create(settings);
 *   2. await p.warmup(onProgress);   // downloads model (WASM) or pings endpoint (HTTP)
 *   3. const vecs = await p.embed(['text 1', 'text 2']);
 *   4. // … later, when changing model/provider:
 *   5. p.dispose();
 *
 * `providerType` and `modelId` are written to SQLite meta on first index so that
 * Migration / re-index logic can detect model changes (Phase 9 Task 9.2).
 */

import type { Chunk } from '../indexer/chunker';

export type ProviderType = 'wasm' | 'ollama' | 'openai-compatible';

export type ProgressCallback = (loaded: number, total: number, phase?: string) => void;

export interface EmbeddingProvider {
    readonly providerType: ProviderType;
    /** Unique model identifier, written into SQLite meta `embedding_model_id`. */
    readonly modelId: string;
    /** Vector dimension. Some providers know this at construction time (WASM
     *  with a known model card); HTTP providers learn it from a warmup probe.
     *  Accessing before `warmup()` may throw — providers document their contract. */
    readonly dimension: number;
    /** UI-facing display name, e.g. 'Built-in (bge-base-zh)'. */
    readonly displayName: string;

    /** Trigger model download / load (WASM) or endpoint ping (HTTP).
     *  MUST be awaited before the first `embed()` call. Safe to call again. */
    warmup(onProgress?: ProgressCallback): Promise<void>;

    /** True once `warmup()` has completed successfully. */
    isReady(): Promise<boolean>;

    /** Embed N texts. Returns N Float32Array, each of length `dimension`. */
    embed(texts: string[]): Promise<Float32Array[]>;

    /** 034 D1: how this provider wants notes chunked. Present only when it
     *  differs from the char-based splitter (see effectiveChunkPolicy). */
    readonly chunkPolicy?: string;

    /** 034 D1: provider-side chunking sized to the model's input limit.
     *  Absent → the indexer falls back to the char-based splitChunks. */
    splitForEmbed?(body: string, title: string): Promise<Chunk[]>;

    /** Release resources (worker termination, model unload). After dispose,
     *  the provider MUST NOT be reused; create a new instance instead. */
    dispose(): void;
}

/** Resources needed by providers but supplied by main.ts (Obsidian-specific). */
export type ProviderContext = {
    /** For WASM: bytes of worker.js (read from plugin folder by main.ts). */
    workerSource?: string;
    /** For WASM: bytes of onnxruntime-web ort-wasm-simd-threaded.wasm. */
    ortWasmBinary?: ArrayBuffer;
    /** Plain `fetch` replacement for Ollama/OpenAI providers. Default = global fetch.
     *  We allow injection so the Obsidian plugin can pass `requestUrl` wrapper. */
    httpFetch?: HttpFetch;
};

export type HttpFetch = (req: HttpRequest) => Promise<HttpResponse>;

export type HttpRequest = {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
};

export type HttpResponse = {
    status: number;
    text: string;
    json: unknown;
};
