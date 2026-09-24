/**
 * WasmEmbeddingProvider — runs transformers.js + Xenova/bge-base-zh inside a
 * Web Worker. The worker source must be supplied by main.ts (read from the
 * plugin folder as a string and passed in via ProviderContext).
 *
 * Dimension is learned from the worker's `ready` message (worker runs a probe
 * embed during init).
 */
import type {
    EmbeddingProvider,
    ProgressCallback,
    ProviderType,
} from './EmbeddingProvider';
import type { Chunk } from '../indexer/chunker';
import { TOKEN_CHUNK_POLICY } from '../indexer/tokenChunker';

export type WasmProviderConfig = {
    modelId: string;     // e.g. 'Xenova/bge-base-zh'
    dtype: 'fp32' | 'fp16' | 'q8' | 'q4';
};

type PendingEmbed = {
    resolve: (vecs: Float32Array[]) => void;
    reject: (err: Error) => void;
};

type PendingSplit = {
    resolve: (chunks: Chunk[]) => void;
    reject: (err: Error) => void;
};

const EMBED_TIMEOUT_MS = 180_000;

export class WasmEmbeddingProvider implements EmbeddingProvider {
    readonly providerType: ProviderType = 'wasm';
    /** 034 D1: chunks are sized in the worker by the model's own tokenizer. */
    readonly chunkPolicy = TOKEN_CHUNK_POLICY;
    readonly displayName: string;

    private worker: Worker | null = null;
    private workerUrl: string | null = null;
    private _dimension: number | null = null;
    private initPromise: Promise<void> | null = null;
    private initResolve: (() => void) | null = null;
    private initReject: ((err: Error) => void) | null = null;
    private onProgress?: ProgressCallback;
    private nextEmbedId = 1;
    private readonly pending = new Map<number, PendingEmbed>();
    private readonly pendingSplit = new Map<number, PendingSplit>();
    private warmedUp = false;

    constructor(
        private readonly cfg: WasmProviderConfig,
        private readonly workerSource: string,
        private readonly ortWasmBinary: ArrayBuffer,
    ) {
        this.displayName = `Built-in (${shortModelName(cfg.modelId)}, ${cfg.dtype})`;
        if (!workerSource) {
            throw new Error('WasmEmbeddingProvider requires workerSource (read worker.js).');
        }
        if (!ortWasmBinary || ortWasmBinary.byteLength === 0) {
            throw new Error('WasmEmbeddingProvider requires ortWasmBinary (fetched by main.ts).');
        }
    }

    get modelId(): string {
        return `${this.cfg.modelId}@${this.cfg.dtype}`;
    }

    get dimension(): number {
        if (this._dimension == null) {
            throw new Error('WasmEmbeddingProvider.dimension accessed before warmup()');
        }
        return this._dimension;
    }

    async warmup(onProgress?: ProgressCallback): Promise<void> {
        if (this.warmedUp) return;
        if (this.initPromise) return this.initPromise;
        this.onProgress = onProgress;
        this.initPromise = new Promise<void>((resolve, reject) => {
            this.initResolve = resolve;
            this.initReject = reject;
        });
        this.bootWorker();
        return this.initPromise;
    }

    async isReady(): Promise<boolean> {
        return this.warmedUp && this._dimension != null && this.worker != null;
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        if (!this.warmedUp || !this.worker) {
            throw new Error('WasmEmbeddingProvider not warmed up. Call warmup() first.');
        }
        const id = this.nextEmbedId++;
        return new Promise<Float32Array[]>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`WASM embed timeout (${EMBED_TIMEOUT_MS / 1000}s)`));
            }, EMBED_TIMEOUT_MS);
            this.pending.set(id, {
                resolve: (vecs) => {
                    window.clearTimeout(timer);
                    resolve(vecs);
                },
                reject: (err) => {
                    window.clearTimeout(timer);
                    reject(err);
                },
            });
            this.worker!.postMessage({ type: 'embed', id, texts });
        });
    }

    /** 034 D1: split a note in the worker, where the tokenizer lives. Shares
     *  the embed id sequence and timeout; a failure rejects only this call
     *  (the worker answers `split-result` with an error, never `init-error`). */
    async splitForEmbed(body: string, title: string): Promise<Chunk[]> {
        if (!this.warmedUp || !this.worker) {
            throw new Error('WasmEmbeddingProvider not warmed up. Call warmup() first.');
        }
        const id = this.nextEmbedId++;
        return new Promise<Chunk[]>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pendingSplit.delete(id);
                reject(new Error(`WASM split timeout (${EMBED_TIMEOUT_MS / 1000}s)`));
            }, EMBED_TIMEOUT_MS);
            this.pendingSplit.set(id, {
                resolve: (chunks) => {
                    window.clearTimeout(timer);
                    resolve(chunks);
                },
                reject: (err) => {
                    window.clearTimeout(timer);
                    reject(err);
                },
            });
            this.worker!.postMessage({ type: 'split', id, body, title });
        });
    }

    dispose(): void {
        if (this.worker) {
            try {
                this.worker.postMessage({ type: 'dispose' });
            } catch {
                /* ignore */
            }
            this.worker.terminate();
            this.worker = null;
        }
        if (this.workerUrl) {
            URL.revokeObjectURL(this.workerUrl);
            this.workerUrl = null;
        }
        this.warmedUp = false;
        this._dimension = null;
        for (const p of this.pending.values()) {
            p.reject(new Error('Provider disposed'));
        }
        this.pending.clear();
        for (const p of this.pendingSplit.values()) {
            p.reject(new Error('Provider disposed'));
        }
        this.pendingSplit.clear();
        this.initPromise = null;
        this.initResolve = null;
        this.initReject = null;
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    private bootWorker(): void {
        const blob = new Blob([this.workerSource], { type: 'application/javascript' });
        this.workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(this.workerUrl);
        this.worker = worker;

        worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(event.data);
        worker.onerror = (event: ErrorEvent) => {
            const err = new Error(event.message || 'WASM worker error');
            this.failInit(err);
        };

        // Clone the ArrayBuffer before postMessage so the plugin instance can
        // reuse `this.ortWasmBinary` for the next provider after a settings
        // change (transferring would detach the buffer on the main side).
        const ortClone = this.ortWasmBinary.slice(0);
        worker.postMessage({
            type: 'init',
            modelId: this.cfg.modelId,
            dtype: this.cfg.dtype,
            ortWasmBinary: ortClone,
        }, [ortClone]);
    }

    private handleWorkerMessage(msg: unknown): void {
        const m = msg as
            | { type: 'ready'; dimension: number }
            | { type: 'init-error'; message: string; stack?: string }
            | { type: 'progress'; loaded: number; total: number; phase?: string }
            | { type: 'result'; id: number; vectors: Float32Array[] | null; error?: string }
            | { type: 'split-result'; id: number; chunks: Chunk[] | null; error?: string }
            | { type: 'log'; message: string };
        if (m.type === 'log') {
            console.warn(m.message);
            return;
        }
        if (m.type === 'ready') {
            this._dimension = m.dimension;
            this.warmedUp = true;
            this.initResolve?.();
        } else if (m.type === 'init-error') {
            this.failInit(new Error(`Worker init failed: ${m.message}`));
        } else if (m.type === 'progress') {
            this.onProgress?.(m.loaded, m.total, m.phase);
        } else if (m.type === 'result') {
            const p = this.pending.get(m.id);
            if (!p) return;
            this.pending.delete(m.id);
            if (m.error || !m.vectors) {
                p.reject(new Error(m.error ?? 'embed failed'));
            } else {
                p.resolve(m.vectors);
            }
        } else if (m.type === 'split-result') {
            const p = this.pendingSplit.get(m.id);
            if (!p) return;
            this.pendingSplit.delete(m.id);
            if (m.error || !m.chunks) {
                p.reject(new Error(m.error ?? 'split failed'));
            } else {
                p.resolve(m.chunks);
            }
        }
    }

    private failInit(err: Error): void {
        this.initReject?.(err);
        this.dispose();
    }
}

function shortModelName(modelId: string): string {
    // 'Xenova/bge-base-zh' → 'bge-base-zh'
    const slash = modelId.lastIndexOf('/');
    return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}
