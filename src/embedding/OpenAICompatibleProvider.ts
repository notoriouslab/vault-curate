/**
 * OpenAICompatibleProvider — /v1/embeddings endpoint compatible with OpenAI,
 * Together AI, Groq, Anyscale, LiteLLM, etc.
 */
import type {
    EmbeddingProvider,
    HttpFetch,
    ProgressCallback,
    ProviderType,
} from './EmbeddingProvider';
import { openaiEndpoint } from '../utils/openaiEndpoint';

const EMBED_TIMEOUT_MS = 90_000;

export type OpenAICompatibleConfig = {
    url: string;        // e.g. https://api.openai.com or http://localhost:8080 (a trailing /v1 is fine)
    model: string;      // e.g. text-embedding-3-small
    apiKey?: string;
};

export class OpenAICompatibleProvider implements EmbeddingProvider {
    readonly providerType: ProviderType = 'openai-compatible';
    readonly displayName: string;
    private _dimension: number | null = null;
    private warmedUp = false;

    constructor(
        private readonly cfg: OpenAICompatibleConfig,
        private readonly httpFetch: HttpFetch,
    ) {
        this.displayName = `OpenAI-compatible: ${cfg.model}`;
    }

    get modelId(): string {
        return `openai-compat:${this.cfg.model}`;
    }

    get dimension(): number {
        if (this._dimension == null) {
            throw new Error('OpenAICompatibleProvider.dimension accessed before warmup()');
        }
        return this._dimension;
    }

    async warmup(_onProgress?: ProgressCallback): Promise<void> {
        const vec = (await this.embedInternal(['_']))[0];
        if (!vec || vec.length === 0) {
            throw new Error(
                `OpenAI-compatible embed probe returned empty vector. Check that model '${this.cfg.model}' exists at ${this.cfg.url} and the API key is valid.`,
            );
        }
        this._dimension = vec.length;
        this.warmedUp = true;
    }

    async isReady(): Promise<boolean> {
        return this.warmedUp && this._dimension != null;
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        return this.embedInternal(texts);
    }

    private async embedInternal(texts: string[]): Promise<Float32Array[]> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.cfg.apiKey) headers['Authorization'] = `Bearer ${this.cfg.apiKey}`;

        const resp = await withTimeout(
            this.httpFetch({
                url: openaiEndpoint(this.cfg.url, 'embeddings'),
                method: 'POST',
                headers,
                body: JSON.stringify({ model: this.cfg.model, input: texts }),
            }),
            EMBED_TIMEOUT_MS,
            'OpenAI embed',
        );
        if (resp.status !== 200) {
            throw new Error(`OpenAI embed ${resp.status}: ${truncate(resp.text, 200)}`);
        }
        const data = resp.json as { data?: { index: number; embedding: number[] }[] };
        const rows = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
        return rows.map((r) => Float32Array.from(r.embedding ?? []));
    }

    dispose(): void {
        this.warmedUp = false;
        this._dimension = null;
    }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: number;
    return Promise.race([
        p.finally(() => window.clearTimeout(timer)),
        new Promise<never>((_, rej) => {
            timer = window.setTimeout(() => rej(new Error(`${label} timeout (${ms / 1000}s)`)), ms);
        }),
    ]);
}

function truncate(s: string | undefined, n: number): string {
    if (!s) return '';
    return s.length > n ? `${s.slice(0, n)}…` : s;
}
