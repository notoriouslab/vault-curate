import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WasmEmbeddingProvider } from '../src/embedding/WasmEmbeddingProvider';
import { createProvider } from '../src/embedding/ProviderRegistry';
import { TOKEN_CHUNK_POLICY } from '../src/indexer/tokenChunker';

/** Minimal stand-in for a dedicated Worker: records posts, lets the test reply. */
class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    posted: Array<Record<string, unknown>> = [];
    terminated = false;
    constructor() { FakeWorker.last = this; }
    postMessage(data: Record<string, unknown>) { this.posted.push(data); }
    terminate() { this.terminated = true; }
    reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

async function readyProvider(): Promise<{ p: WasmEmbeddingProvider; w: FakeWorker }> {
    const p = new WasmEmbeddingProvider({ modelId: 'Xenova/test', dtype: 'q8' }, 'worker-src', new ArrayBuffer(1));
    const warm = p.warmup();
    const w = FakeWorker.last!;
    w.reply({ type: 'ready', dimension: 4 });
    await warm;
    return { p, w };
}

const lastOf = (w: FakeWorker, type: string) => [...w.posted].reverse().find((m) => m.type === type)!;

describe('WasmEmbeddingProvider split protocol', () => {
    beforeEach(() => {
        vi.stubGlobal('Worker', FakeWorker);
        vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        FakeWorker.last = null;
    });

    it('(a) resolves with the chunks from split-result and advertises the token policy', async () => {
        const { p, w } = await readyProvider();
        expect(p.chunkPolicy).toBe(TOKEN_CHUNK_POLICY);
        const pending = p.splitForEmbed('body', 'Title');
        const msg = lastOf(w, 'split');
        expect(msg).toMatchObject({ body: 'body', title: 'Title' });
        const chunks = [{ content: 'Title\nbody', chunkIndex: 0 }];
        w.reply({ type: 'split-result', id: msg.id, chunks });
        await expect(pending).resolves.toEqual(chunks);
    });

    it('(b) rejects on a split error without disposing the provider', async () => {
        const { p, w } = await readyProvider();
        const pending = p.splitForEmbed('body', 'Title');
        w.reply({ type: 'split-result', id: lastOf(w, 'split').id, chunks: null, error: 'boom' });
        await expect(pending).rejects.toThrow('boom');
        expect(await p.isReady()).toBe(true);
        expect(w.terminated).toBe(false);
        const embedding = p.embed(['x']);
        w.reply({ type: 'result', id: lastOf(w, 'embed').id, vectors: [new Float32Array(4)] });
        await expect(embedding).resolves.toHaveLength(1);
    });

    it('(c) rejects an in-flight split when the provider is disposed', async () => {
        const { p } = await readyProvider();
        const pending = p.splitForEmbed('body', 'Title');
        p.dispose();
        await expect(pending).rejects.toThrow('Provider disposed');
    });

    it('(d) throws when called before warmup', async () => {
        const p = new WasmEmbeddingProvider({ modelId: 'Xenova/test', dtype: 'q8' }, 'worker-src', new ArrayBuffer(1));
        await expect(p.splitForEmbed('body', 'Title')).rejects.toThrow('not warmed up');
    });
});

describe('WasmEmbeddingProvider model download source (039)', () => {
    const workers: FakeWorker[] = [];
    class TrackedWorker extends FakeWorker {
        constructor() { super(); workers.push(this); }
    }
    beforeEach(() => {
        workers.length = 0;
        vi.stubGlobal('Worker', TrackedWorker);
        // Keep the real URL class: modelHostLabel parses hosts with `new URL`.
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = () => 'blob:fake';
            static revokeObjectURL = () => {};
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        FakeWorker.last = null;
    });

    const make = (getHost?: () => string | undefined) =>
        new WasmEmbeddingProvider({ modelId: 'Xenova/test', dtype: 'q8' }, 'worker-src', new ArrayBuffer(1), getHost);

    it('sends remoteUrl only when a host is configured', async () => {
        const withHost = make(() => 'http://127.0.0.1:8765');
        void withHost.warmup();
        expect(lastOf(workers[0], 'init').remoteUrl).toBe('http://127.0.0.1:8765');

        const noHost = make(() => undefined);
        void noHost.warmup();
        expect('remoteUrl' in lastOf(workers[1], 'init')).toBe(false);

        const noGetter = make();
        void noGetter.warmup();
        expect('remoteUrl' in lastOf(workers[2], 'init')).toBe(false);
    });

    it('reads the host again on the next warmup after a failed download', async () => {
        let host = 'http://a.test';
        const p = make(() => host);
        const first = p.warmup();
        workers[0].reply({ type: 'init-error', message: 'Failed to fetch' });
        await expect(first).rejects.toThrow();
        host = 'http://b.test';
        void p.warmup();
        expect(workers).toHaveLength(2);
        expect(lastOf(workers[1], 'init').remoteUrl).toBe('http://b.test');
    });

    it('words a fetch failure as an unreachable download naming the host', async () => {
        const p = make(() => undefined);
        const warm = p.warmup();
        workers[0].reply({ type: 'init-error', message: 'Failed to fetch' });
        await expect(warm).rejects.toThrow(
            'Couldn\'t download the built-in model (can\'t reach huggingface.co). Switch the download source in settings, or use Ollama. (Failed to fetch)',
        );
    });

    it('words an HTTP error from the host as a failed download (G3 F5)', async () => {
        const p = make(() => undefined);
        const warm = p.warmup();
        workers[0].reply({
            type: 'init-error',
            message: 'Could not locate file: "https://huggingface.co/Xenova/test/resolve/main/config.json".',
        });
        await expect(warm).rejects.toThrow(
            'Couldn\'t download the built-in model from huggingface.co. Check the download source in settings, or use Ollama. '
            + '(Could not locate file: "https://huggingface.co/Xenova/test/resolve/main/config.json".)',
        );
    });

    it('a throwing host getter falls back to the default and leaves no hung init (G3 F1)', async () => {
        const p = make(() => { throw new TypeError('bad setting'); });
        const warm = p.warmup();
        expect(workers).toHaveLength(1);
        expect('remoteUrl' in lastOf(workers[0], 'init')).toBe(false);
        workers[0].reply({ type: 'ready', dimension: 4 });
        await expect(warm).resolves.toBeUndefined();
    });

    it('createProvider hands getModelHost to the WASM provider (G3 F3)', async () => {
        const p = createProvider(
            { providerType: 'wasm', wasmModelId: 'Xenova/test', wasmDtype: 'q8' },
            { workerSource: 'worker-src', ortWasmBinary: new ArrayBuffer(1), getModelHost: () => 'http://127.0.0.1:8765' },
        );
        void p.warmup();
        expect(lastOf(workers[0], 'init').remoteUrl).toBe('http://127.0.0.1:8765');
    });

    it('keeps the generic wording for non-download init errors', async () => {
        const p = make(() => undefined);
        const warm = p.warmup();
        workers[0].reply({ type: 'init-error', message: 'no available backend found' });
        await expect(warm).rejects.toThrow(/^Worker init failed: no available backend found$/);
    });
});
