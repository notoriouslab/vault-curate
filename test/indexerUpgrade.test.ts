import { describe, it, expect } from 'vitest';
import { makeHarness, makeProvider, notesWith, noteNames } from './helpers/indexerHarness';
import { splitChunks } from '../src/indexer/chunker';

const META_POLICY = 'chunk_policy';
const META_TARGET = 'chunk_upgrade_target';

/** An index built before 034: every note indexed, but no chunk_policy stamp. */
async function prePolicyIndex(tokenPolicy: boolean, n = 4) {
    const h = await makeHarness(notesWith(n), makeProvider({ tokenPolicy }));
    await h.indexer.rebuild();
    h.store.deleteMeta(META_POLICY);
    return h;
}

describe('indexer chunk-policy upgrade', () => {
    it('(a) re-embeds every note on a pre-policy index and stamps when done', async () => {
        const h = await prePolicyIndex(true);
        const p = makeProvider({ tokenPolicy: true });
        h.setProvider(p);
        await h.indexer.update();
        expect(p.splitCalls).toHaveLength(4);
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
        expect(h.store.getMeta(META_TARGET)).toBeNull();
    });

    it('(b) does nothing on the next update', async () => {
        const h = await prePolicyIndex(true);
        await h.indexer.update();
        const p = makeProvider({ tokenPolicy: true });
        h.setProvider(p);
        await h.indexer.update();
        expect(p.splitCalls).toHaveLength(0);
        expect(p.embedCalls).toBe(0);
    });

    it('(c) only stamps an external provider on a pre-policy index', async () => {
        const h = await prePolicyIndex(false);
        const p = makeProvider({ tokenPolicy: false });
        h.setProvider(p);
        await h.indexer.update();
        expect(p.embedCalls).toBe(0);
        expect(h.store.getMeta(META_POLICY)).toBe('char2000-o100');
    });

    it('(d) resumes: notes indexed since the target started are skipped', async () => {
        const h = await prePolicyIndex(true);
        const T = 1_000_000;
        h.store.setMeta(META_TARGET, `tok512-v1@${T}#0`);
        const names = noteNames(4);
        names.forEach((path, i) => {
            const n = h.store.getNote(path)!;
            h.store.upsertNote({ ...n, indexedAt: i < 2 ? T + 1 : T - 1 });
        });
        const p = makeProvider({ tokenPolicy: true });
        h.setProvider(p);
        await h.indexer.update();
        expect([...p.splitCalls].sort()).toEqual(['note2', 'note3']);
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
    });

    it('(e) a single-file edit before the upgrade does not stamp the policy', async () => {
        const h = await prePolicyIndex(true);
        await h.indexer.indexSingleFile(h.files.get('note0.md')!.file);
        expect(h.store.getMeta(META_POLICY)).toBeNull();
    });

    it('(f) clearAllData removes both upgrade keys', async () => {
        const h = await prePolicyIndex(true);
        h.store.setMeta(META_POLICY, 'tok512-v1');
        h.store.setMeta(META_TARGET, 'tok512-v1@1#0');
        h.store.clearAllData();
        expect(h.store.getMeta(META_POLICY)).toBeNull();
        expect(h.store.getMeta(META_TARGET)).toBeNull();
    });

    it('(g) a target for another policy restarts the upgrade', async () => {
        const h = await prePolicyIndex(true);
        const T = 1_000_000;
        h.store.setMeta(META_TARGET, `tok511-v0@${T}#2`);
        noteNames(4).forEach((path) => {
            const n = h.store.getNote(path)!;
            h.store.upsertNote({ ...n, indexedAt: T + 1 });
        });
        const p = makeProvider({ tokenPolicy: true });
        h.setProvider(p);
        await h.indexer.update();
        expect(p.splitCalls).toHaveLength(4);
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
        expect(h.store.getMeta(META_TARGET)).toBeNull();
    });

    it('(h) failures keep the target and a later pass retries only them', async () => {
        const h = await prePolicyIndex(true);
        const failing = makeProvider({ tokenPolicy: true, failPaths: new Set(['note1', 'note3']) });
        h.setProvider(failing);
        await h.indexer.update();
        expect(h.store.getMeta(META_POLICY)).toBeNull();
        expect(h.store.getMeta(META_TARGET)).toMatch(/^tok512-v1@\d+#1$/);

        const healthy = makeProvider({ tokenPolicy: true });
        h.setProvider(healthy);
        await h.indexer.update();
        expect([...healthy.splitCalls].sort()).toEqual(['note1', 'note3']);
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
        expect(h.store.getMeta(META_TARGET)).toBeNull();
    });

    it('(i) indexOne chunks through splitForEmbed when the provider offers it', async () => {
        const p = makeProvider({ tokenPolicy: true });
        const h = await makeHarness(notesWith(3), p);
        await h.indexer.rebuild();
        expect([...p.splitCalls].sort()).toEqual(['note0', 'note1', 'note2']);
    });

    it('(j) indexOne falls back to splitChunks without splitForEmbed', async () => {
        const p = makeProvider({ tokenPolicy: false });
        const notes = notesWith(1);
        const h = await makeHarness(notes, p);
        await h.indexer.rebuild();
        const stored = h.store.getChunks('note0.md').map((c) => c.content);
        const expected = splitChunks(notes['note0.md'], 'note0', { chunkSize: 2000, chunkOverlap: 100 }).map((c) => c.content);
        expect(stored).toEqual(expected);
    });

    it('(k) a fresh index with a failure records a target and retries only that note', async () => {
        const h = await makeHarness(notesWith(3), makeProvider({ tokenPolicy: true, failPaths: new Set(['note1']) }));
        await h.indexer.update();
        expect(h.store.getMeta(META_POLICY)).toBeNull();
        expect(h.store.getMeta(META_TARGET)).toMatch(/^tok512-v1@\d+#1$/);

        const healthy = makeProvider({ tokenPolicy: true });
        h.setProvider(healthy);
        await h.indexer.update();
        expect(healthy.splitCalls).toEqual(['note1']);
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
    });

    it('(l) gives up after the third failing pass and stops retrying', async () => {
        const h = await prePolicyIndex(true);
        const failing = makeProvider({ tokenPolicy: true, failPaths: new Set(['note2']) });
        h.setProvider(failing);
        await h.indexer.update();
        expect(h.store.getMeta(META_TARGET)).toMatch(/#1$/);
        await h.indexer.update();
        expect(h.store.getMeta(META_TARGET)).toMatch(/#2$/);
        await h.indexer.update();
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
        expect(h.store.getMeta(META_TARGET)).toBeNull();

        const later = makeProvider({ tokenPolicy: true, failPaths: new Set(['note2']) });
        h.setProvider(later);
        await h.indexer.update();
        expect(later.splitCalls).toHaveLength(0);
    });

    it('(m) does not warm the provider back up once the store is disposed', async () => {
        const h = await prePolicyIndex(true);
        const p = makeProvider({ tokenPolicy: true });
        p.isReady = async () => false;
        p.splitForEmbed = async () => {
            void h.store.dispose();
            throw new Error('unloading');
        };
        h.setProvider(p);
        const warmupsBefore = p.warmupCalls;
        await h.indexer.update().catch(() => { /* a disposed store may throw on the way out */ });
        // update() warms once at its start (isReady is false); the failure
        // handler must not warm again after the store is gone.
        expect(p.warmupCalls - warmupsBefore).toBe(1);
    });

    /** A provider whose worker dies on note1: isReady turns false until warmup. */
    function crashingOn(crashTitle: string, warmupWorks: boolean) {
        const p = makeProvider({ tokenPolicy: true });
        let ready = true;
        p.isReady = async () => ready;
        p.warmup = async () => {
            p.warmupCalls++;
            if (!warmupWorks) throw new Error('worker cannot restart');
            ready = true;
        };
        const split = p.splitForEmbed!;
        p.splitForEmbed = async (body, title) => {
            if (title === crashTitle && ready) {
                p.splitCalls.push(title);
                ready = false;
                throw new Error('worker crashed');
            }
            return split(body, title);
        };
        return p;
    }

    it('(n) restarts a crashed worker and carries on with the remaining notes', async () => {
        const h = await prePolicyIndex(true);
        const p = crashingOn('note1', true);
        h.setProvider(p);
        await h.indexer.update();
        expect(p.warmupCalls).toBe(1);
        expect(p.splitCalls).toEqual(['note0', 'note1', 'note2', 'note3']);
        // note1 failed once, so the upgrade is recorded as unfinished.
        expect(h.store.getMeta(META_TARGET)).toMatch(/#1$/);
    });

    it('(o) a pass that loses its provider does not count as an attempt', async () => {
        const h = await prePolicyIndex(true);
        const p = crashingOn('note1', false);
        h.setProvider(p);
        await h.indexer.update();
        expect(p.splitCalls).toEqual(['note0', 'note1']);
        expect(h.store.getMeta(META_POLICY)).toBeNull();
        expect(h.store.getMeta(META_TARGET)).toMatch(/#0$/);

        const healthy = makeProvider({ tokenPolicy: true });
        h.setProvider(healthy);
        await h.indexer.update();
        expect([...healthy.splitCalls].sort()).toEqual(['note1', 'note2', 'note3']);
        expect(h.store.getMeta(META_POLICY)).toBe('tok512-v1');
    });

    it('(p) stops without writing meta when the provider is swapped mid-pass', async () => {
        const h = await prePolicyIndex(true);
        const a = makeProvider({ tokenPolicy: true });
        const b = makeProvider({ tokenPolicy: true });
        b.modelId = 'model-B';
        const split = a.splitForEmbed!;
        a.splitForEmbed = async (body, title) => {
            if (title === 'note1') {
                h.setProvider(b); // what reloadBackends does from the settings tab
                throw new Error('provider disposed');
            }
            return split(body, title);
        };
        h.setProvider(a);
        await h.indexer.update();
        expect(b.splitCalls).toHaveLength(0);
        expect(b.warmupCalls).toBe(0);
        expect(h.store.getMeta('embedding_model_id')).toBe('fake-model');
        expect(h.store.getMeta(META_POLICY)).toBeNull();
    });
});
