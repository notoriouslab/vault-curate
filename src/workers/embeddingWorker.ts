/**
 * Embedding Worker — full transformers.js integration.
 *
 * Boot sequence:
 *   1. Main thread posts `{type:'init', modelId, dtype, wasmBinary}`.
 *   2. Worker configures @huggingface/transformers env (browser cache + ort wasm
 *      binary supplied by main thread) and loads the feature-extraction pipeline.
 *   3. Worker posts `{type:'ready', dimension}` on success or
 *      `{type:'init-error', message, stack}` on failure.
 *   4. During download/load, transformers' progress events are forwarded as
 *      `{type:'progress', loaded, total, phase}`.
 *
 * Embed protocol:
 *   - Main posts `{type:'embed', id, texts}`.
 *   - Worker replies `{type:'result', id, vectors}` (vectors are Float32Array[]).
 *
 * Split protocol (034 D1):
 *   - Main posts `{type:'split', id, body, title}`.
 *   - Worker replies `{type:'split-result', id, chunks}`, sizing each chunk
 *     with the loaded model's tokenizer so none exceeds its input window.
 *
 * Dispose:
 *   - Main can post `{type:'dispose'}` to release the model.
 *
 * Workarounds for Electron — see esbuild.config.mjs banner (process.release.name
 * patch must run BEFORE this file's first import of @huggingface/transformers).
 */

import { splitChunksByTokens } from '../indexer/tokenChunker';
import { denoiseForEmbed } from '../indexer/denoise';
import { t2sForEmbed } from '../indexer/preproc';
import { errorReply } from './workerReply';

// `self` typing avoided to keep tsconfig out of WebWorker lib (which conflicts
// with the DOM lib used by the main bundle).
const ctx = self as unknown as {
    postMessage: (data: unknown, transfer?: Transferable[]) => void;
    onmessage: ((event: MessageEvent) => void) | null;
};

type InitMsg = {
    type: 'init';
    modelId: string;
    dtype?: 'fp32' | 'fp16' | 'q8' | 'q4';
    /** Pass-through option to transformers.js env if main thread wants to
     *  override the default HF Hub URL. */
    remoteUrl?: string;
    /** ORT WASM binary fetched by main thread via Obsidian's `requestUrl`
     *  (browser `fetch()` from `app://obsidian.md` is CORS-blocked against
     *  github.com). Set on `env.backends.onnx.wasm.wasmBinary` so the WASM
     *  fallback path doesn't try to fetch from a URL at all. WebGPU path
     *  ignores this. */
    ortWasmBinary?: ArrayBuffer;
};
type EmbedMsg = { type: 'embed'; id: number; texts: string[] };
type SplitMsg = { type: 'split'; id: number; body: string; title: string };
type DisposeMsg = { type: 'dispose' };
type IncomingMsg = InitMsg | EmbedMsg | SplitMsg | DisposeMsg;

// The feature-extraction pipeline is callable and also carries its tokenizer.
type Extractor = ((
    text: string | string[],
    options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>) & {
    tokenizer: { encode(s: string): number[]; model_max_length: number };
};

let extractor: Extractor | null = null;
let modelDimension: number | null = null;

/** Forward a log line to the main thread (worker console.* is invisible in Obsidian DevTools). */
function postLog(msg: string): void {
    ctx.postMessage({ type: 'log', message: msg });
}

ctx.onmessage = (event: MessageEvent<IncomingMsg>) => {
    void (async () => {
        const msg = event.data;
        try {
            if (msg.type === 'init') {
                await handleInit(msg);
            } else if (msg.type === 'embed') {
                await handleEmbed(msg);
            } else if (msg.type === 'split') {
                handleSplit(msg);
            } else if (msg.type === 'dispose') {
                extractor = null;
                modelDimension = null;
            }
        } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : undefined;
            ctx.postMessage(errorReply(msg, m, stack));
        }
    })();
};

async function handleInit(msg: InitMsg): Promise<void> {
    // CRITICAL — joybro/obsidian-similar-notes workaround (issue
    // huggingface/transformers.js#1238): Obsidian's Electron renderer sets
    // `process` (with release.name === 'node') inside dedicated workers,
    // tripping transformers.js's env.js Node-detection. The downstream
    // `return_path = true` branch then breaks model loading.
    // Removing `process` outright forces the browser path. Must happen
    // BEFORE the transformers dynamic import below.
    // Worker scope has no `window`. `self` is the WorkerGlobalScope and is
    // the lint-friendly substitute for `globalThis` here.
    Object.defineProperty(self, 'process', {
        get: () => undefined,
        configurable: true,
    });

    // Dynamic import so the bundle only loads transformers when init runs.
    // esbuild's alias in worker stage maps this to transformers.web.js.
    const tfm = await import('@huggingface/transformers');
    if (msg.remoteUrl) {
        // Defence-in-depth: reject non-http(s) schemes (file:// / data: etc.)
        // even though main thread shouldn't pass this through.
        if (!/^https?:\/\//i.test(msg.remoteUrl)) {
            throw new Error('Worker init: remoteUrl must use http or https scheme');
        }
        // Optional override; default points at huggingface.co
        (tfm.env as unknown as { remoteHost: string }).remoteHost = msg.remoteUrl;
    }

    // ORT wasm tuning still applies to the wasm fallback path. WebGPU path
    // ignores these. The WASM binary is supplied by main thread via
    // `msg.ortWasmBinary` and set as `env.backends.onnx.wasm.wasmBinary` —
    // onnxruntime-web instantiates from the bytes directly instead of
    // fetching from a URL (which would be CORS-blocked under Obsidian's
    // `app://obsidian.md` origin).
    const ortWasm = (tfm.env as unknown as {
        backends?: {
            onnx?: {
                wasm?: {
                    proxy?: boolean;
                    numThreads?: number;
                    wasmBinary?: ArrayBufferLike;
                };
            };
        };
    }).backends?.onnx?.wasm;
    if (ortWasm) {
        ortWasm.proxy = false;
        ortWasm.numThreads = 1;
        if (msg.ortWasmBinary) {
            ortWasm.wasmBinary = msg.ortWasmBinary;
        }
    }

    const pipeline = tfm.pipeline;

    // WebGPU backend doesn't accept int8 quantization — only fp32/fp16
    // model files exist on the HF Hub for the WebGPU path. WASM backend
    // takes q8 fine and runs ~4x faster on int8 ops. So we pick per device.
    const dtypeForDevice = (device: 'webgpu' | 'wasm'): 'fp32' | 'fp16' | 'q8' | 'q4' => {
        if (device === 'webgpu') return 'fp32';
        return msg.dtype ?? 'q8';
    };

    const buildPipeline = (device: 'webgpu' | 'wasm') => pipeline(
        'feature-extraction',
        msg.modelId,
        {
            device,
            dtype: dtypeForDevice(device),
            progress_callback: (p: unknown) => {
                const pe = p as { status?: string; loaded?: number; total?: number; file?: string };
                if (pe && pe.status && typeof pe.loaded === 'number' && typeof pe.total === 'number') {
                    ctx.postMessage({
                        type: 'progress',
                        loaded: pe.loaded,
                        total: pe.total,
                        phase: `${pe.status}${pe.file ? ` ${pe.file}` : ''}`,
                    });
                }
            },
        },
    );

    const hasWebGpu = typeof (self as unknown as { navigator?: { gpu?: unknown } }).navigator?.gpu !== 'undefined';
    postLog(`[vault-curate worker] hasWebGpu=${hasWebGpu}`);
    let built: unknown;
    if (hasWebGpu) {
        try {
            postLog(`[vault-curate worker] trying device=webgpu dtype=fp32 model=${msg.modelId}`);
            built = await buildPipeline('webgpu');
            postLog(`[vault-curate worker] device=webgpu ready`);
        } catch (err) {
            const msg2 = err instanceof Error ? err.message : String(err);
            postLog(`[vault-curate worker] webgpu failed (${msg2}); falling back to wasm`);
            built = await buildPipeline('wasm');
            postLog(`[vault-curate worker] device=wasm ready (after webgpu failure)`);
        }
    } else {
        postLog(`[vault-curate worker] no navigator.gpu — device=wasm`);
        built = await buildPipeline('wasm');
        postLog(`[vault-curate worker] device=wasm ready`);
    }
    extractor = built as Extractor;

    // Probe with a tiny input to discover dimension.
    const probe = await extractor('_', { pooling: 'mean', normalize: true });
    modelDimension = probe.dims[probe.dims.length - 1];

    ctx.postMessage({ type: 'ready', dimension: modelDimension });
}

async function handleEmbed(msg: EmbedMsg): Promise<void> {
    if (!extractor) throw new Error('worker not initialised (call init first)');
    const vectors: Float32Array[] = [];
    for (const text of msg.texts) {
        const out = await extractor(text, { pooling: 'mean', normalize: true });
        // out.data is a typed array view; copy into a standalone Float32Array
        // so transferring back to main thread isn't aliased.
        const copy = new Float32Array(out.data.length);
        copy.set(out.data);
        vectors.push(copy);
    }
    // Transfer the underlying buffers to avoid a structured-clone copy.
    const transfers = vectors.map((v) => v.buffer);
    ctx.postMessage({ type: 'result', id: msg.id, vectors }, transfers);
}

function handleSplit(msg: SplitMsg): void {
    if (!extractor) throw new Error('worker not initialised (call init first)');
    const tokenizer = extractor.tokenizer;
    const mml = tokenizer.model_max_length;
    const maxTokens = Number.isFinite(mml) && mml > 0 ? Math.min(512, mml) : 512;
    // Count the exact string the indexer will embed (indexer.ts embeds
    // denoiseForEmbed(t2sForEmbed(content))), not the stored raw text.
    const countTokens = (s: string) => tokenizer.encode(denoiseForEmbed(t2sForEmbed(s))).length;
    const chunks = splitChunksByTokens(msg.body, msg.title, countTokens, {
        maxTokens,
        overlapChars: 50,
        maxWindowChars: 2000,
        maxTitleChars: 64,
    });
    ctx.postMessage({ type: 'split-result', id: msg.id, chunks });
}

export {};
