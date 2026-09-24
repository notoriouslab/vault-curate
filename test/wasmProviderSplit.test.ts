import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WasmEmbeddingProvider } from '../src/embedding/WasmEmbeddingProvider';
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
