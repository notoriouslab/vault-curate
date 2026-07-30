import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { KnnGraphManager, type KnnStoreLike } from '../src/search/knnGraphManager';
import { buildKnnPicks, buildKnnGraph, type KnnGraph } from '../src/search/semanticPath';
import { packPicks } from '../src/search/knnCodec';

const K = 3;
const CAP = 0;

function at(deg: number): Float32Array {
    const r = (deg * Math.PI) / 180;
    return new Float32Array([Math.cos(r), Math.sin(r)]);
}

/** Fake store: path→vec rows + a revision that jumps by 8 per mutation
 *  (the real indexSingleFile touch multiplier, red-team C4). */
class FakeStore implements KnnStoreLike {
    private rows = new Map<string, Float32Array>();
    private revision = 0;
    upsert(path: string, vec: Float32Array): void {
        this.rows.set(path, vec);
        this.revision += 8;
    }
    remove(path: string): void {
        this.rows.delete(path);
        this.revision += 8;
    }
    /** A mutation that bypasses hooks entirely (bulk / clearAllData). */
    bulkTouch(): void { this.revision += 100; }
    getAllNotesLight() {
        return [...this.rows].map(([path, noteVec]) => ({ path, noteVec }));
    }
    getNoteVec(path: string): Float32Array | null { return this.rows.get(path) ?? null; }
    getRevision(): number { return this.revision; }
}

/** Controllable fake worker speaking the knn protocol. */
class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    terminated = false;
    lastBuild: {
        matrixBuffer: ArrayBuffer; dim: number; paths: string[];
        k: number; sameFolderCap: number;
    } | null = null;
    constructor(private auto: boolean) {}
    postMessage(msg: unknown, _t?: Transferable[]): void {
        this.lastBuild = msg as FakeWorker['lastBuild'];
        if (this.auto) queueMicrotask(() => this.emitDone());
    }
    terminate(): void { this.terminated = true; }
    /** Compute the REAL picks (same code path as the actual worker). */
    emitDone(): void {
        const b = this.lastBuild!;
        const matrix = new Float32Array(b.matrixBuffer);
        const notes = b.paths.map((p, i) => ({
            path: p,
            vec: matrix.subarray(i * b.dim, (i + 1) * b.dim),
        }));
        const picks = buildKnnPicks(notes, b.k, b.sameFolderCap);
        const pathIndex = new Map(b.paths.map((p, i) => [p, i]));
        const packed = packPicks(picks, b.paths, pathIndex);
        this.onmessage?.({
            data: {
                type: 'knn-done',
                pickCounts: packed.pickCounts,
                pickTargets: packed.pickTargets,
                pickSims: packed.pickSims,
                matrixBuffer: b.matrixBuffer,
            },
        } as MessageEvent);
    }
}

function makeManager(opts?: {
    auto?: boolean;
    driftRatio?: number;
    cooldownMs?: number;
    now?: () => number;
    failSpawn?: boolean;
    isBulkIndexing?: () => boolean;
}) {
    const workers: FakeWorker[] = [];
    const manager = new KnnGraphManager({
        spawnWorker: () => {
            if (opts?.failSpawn) throw new Error('no worker in this env');
            const w = new FakeWorker(opts?.auto ?? true);
            workers.push(w);
            return w as unknown as Worker;
        },
        k: K,
        sameFolderCap: CAP,
        driftRatio: opts?.driftRatio,
        cooldownMs: opts?.cooldownMs,
        now: opts?.now,
        isBulkIndexing: opts?.isBulkIndexing,
        log: () => { /* silent in tests */ },
    });
    return { manager, workers };
}

function seedStore(): FakeStore {
    const store = new FakeStore();
    store.upsert('a.md', at(0));
    store.upsert('b.md', at(20));
    store.upsert('c.md', at(45));
    store.upsert('d.md', at(90));
    store.upsert('e.md', at(180));
    return store;
}

async function settle(): Promise<void> {
    // Drain the microtask queue a few rounds (fake worker completes async).
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('KnnGraphManager', () => {
    it('1. revision-aligned queries reuse the resident graph (single spawn)', async () => {
        const { manager, workers } = makeManager();
        const store = seedStore();
        const first = await manager.getGraph(store);
        const second = await manager.getGraph(store);
        expect(workers).toHaveLength(1);
        if (first.cancelled || second.cancelled) throw new Error('unexpected cancel');
        expect(second.graph).toBe(first.graph);
    });

    it('2. backstop: a hook-bypassing revision jump forces a full rebuild', async () => {
        const { manager, workers } = makeManager();
        const store = seedStore();
        await manager.getGraph(store);
        store.bulkTouch(); // no hook fired
        await manager.getGraph(store);
        expect(workers).toHaveLength(2);
    });

    it('3. hook sequence maintains the graph (add present, removed absent, exact own picks)', async () => {
        // driftRatio 10 disables the background self-heal so the assertions
        // read the incrementally-maintained state, not a completed rebuild.
        const { manager, workers } = makeManager({ driftRatio: 10 });
        const store = seedStore();
        await manager.getGraph(store);
        store.upsert('f.md', at(60));
        manager.onMutation('upsert', 'f.md', store);
        store.remove('b.md');
        manager.onMutation('remove', 'b.md', store);
        // f is upserted once more so it is the LAST mutation — the pinned
        // invariant is "exact as of the node's own last change" (a pick of
        // b would otherwise be stripped without backfill, by design).
        manager.onMutation('upsert', 'f.md', store);
        const out = await manager.getGraph(store);
        if (out.cancelled) throw new Error('unexpected cancel');
        expect(workers).toHaveLength(1); // maintained, not rebuilt
        expect(out.graph.has('f.md')).toBe(true);
        expect(out.graph.has('b.md')).toBe(false);
        // The changed node's OWN picks are exact (union-graph reverse edges
        // from other nodes may drift — D6 #3): every full-build pick of f
        // must be present with the identical sim.
        const fullPicks = buildKnnPicks(
            store.getAllNotesLight().map((r) => ({ path: r.path, vec: r.noteVec })), K, CAP);
        for (const pick of fullPicks.get('f.md')!) {
            const edge = out.graph.get('f.md')!.find((e) => e.path === pick.path);
            expect(edge).toBeDefined();
            expect(edge!.sim).toBe(pick.sim);
        }
    });

    it('4. hooks before the first build are a no-op (no spawn, no throw)', async () => {
        const { manager, workers } = makeManager();
        const store = seedStore();
        manager.onMutation('upsert', 'a.md', store);
        expect(workers).toHaveLength(0);
    });

    it('5. dim-mismatch upsert flags the state; next query rebuilds', async () => {
        const { manager, workers } = makeManager();
        const store = seedStore();
        await manager.getGraph(store);
        store.upsert('odd.md', new Float32Array([1, 0, 0]));
        manager.onMutation('upsert', 'odd.md', store);
        await manager.getGraph(store);
        expect(workers).toHaveLength(2);
    });

    it('6. drift triggers ONE background rebuild; cooldown holds the next as pending', async () => {
        let clock = 0;
        const { manager, workers } = makeManager({ driftRatio: 0.2, cooldownMs: 60_000, now: () => clock });
        const store = seedStore(); // n=5, ratio 0.2 → rebuild at 1 change
        await manager.getGraph(store);
        expect(workers).toHaveLength(1);
        store.upsert('a.md', at(10));
        manager.onMutation('upsert', 'a.md', store); // crosses drift → background rebuild
        await settle();
        expect(workers).toHaveLength(2);
        // Within cooldown: another drift-crossing change only marks pending.
        clock = 30_000;
        store.upsert('b.md', at(30));
        manager.onMutation('upsert', 'b.md', store);
        await settle();
        expect(workers).toHaveLength(2);
        // After cooldown, the pending rebuild fires on the next activity.
        clock = 120_000;
        store.upsert('c.md', at(50));
        manager.onMutation('upsert', 'c.md', store);
        await settle();
        expect(workers).toHaveLength(3);
    });

    it('7. real SQLiteStore: the touch multiplier does not fool the alignment', async () => {
        const store = realStore;
        // driftRatio 10: with n=2 the default 5% would legitimately schedule
        // a self-heal on the first hook — this test isolates the alignment.
        const { manager, workers } = makeManager({ driftRatio: 10 });
        seedReal(store, 'x.md', at(0));
        seedReal(store, 'y.md', at(30));
        await manager.getGraph(store);
        expect(workers).toHaveLength(1);
        // One "edit": upsertNote + upsertChunks + several setMeta — revision
        // jumps far more than 1. The hook aligns by overwrite, so the next
        // query must NOT rebuild.
        seedReal(store, 'x.md', at(10));
        store.setMeta('last_indexed_at', '123');
        store.setMeta('t2s_version', '9');
        manager.onMutation('upsert', 'x.md', store);
        await manager.getGraph(store);
        expect(workers).toHaveLength(1);
    });

    it('8. generation token: a done arriving after cancel is discarded', async () => {
        const { manager, workers } = makeManager({ auto: false });
        const store = seedStore();
        const pending = manager.getGraph(store);
        await settle();
        expect(workers).toHaveLength(1);
        manager.cancel();
        const outcome = await pending;
        expect(outcome.cancelled).toBe(true);
        workers[0].emitDone(); // the late message — must be ignored
        await settle();
        // State stayed unbuilt: the next query spawns a fresh build.
        const again = manager.getGraph(store);
        await settle();
        expect(workers).toHaveLength(2);
        workers[1].emitDone();
        const ok = await again;
        expect(ok.cancelled ?? false).toBe(false);
    });

    it('9. mutations during a build are queued and replayed onto the new state', async () => {
        const { manager, workers } = makeManager({ auto: false });
        const store = seedStore();
        const pending = manager.getGraph(store);
        await settle();
        store.upsert('f.md', at(60));
        manager.onMutation('upsert', 'f.md', store); // in-flight → queued
        workers[0].emitDone(); // built WITHOUT f.md, replay adds it
        const out = await pending;
        if (out.cancelled) throw new Error('unexpected cancel');
        expect(out.graph.has('f.md')).toBe(true);
        // And the alignment covers the queued mutation: no rebuild next query.
        await manager.getGraph(store);
        expect(workers).toHaveLength(1);
    });

    it('10. spawn failure falls back to a sync build, then retries the worker on the next build', async () => {
        const failToggle = { fail: true };
        const workers: FakeWorker[] = [];
        let attempts = 0;
        const manager = new KnnGraphManager({
            spawnWorker: () => {
                attempts++;
                if (failToggle.fail) throw new Error('boom');
                const w = new FakeWorker(true);
                workers.push(w);
                return w as unknown as Worker;
            },
            k: K, sameFolderCap: CAP, log: () => {},
        });
        const store = seedStore();
        const out = await manager.getGraph(store);
        if (out.cancelled) throw new Error('unexpected cancel');
        expect(out.fallback).toBe(true);
        expect(attempts).toBe(1);
        const expected = buildKnnGraph(
            store.getAllNotesLight().map((r) => ({ path: r.path, vec: r.noteVec })), K, CAP);
        expect(out.graph).toEqual(expected);
        // Fallback state is resident and aligned — cached until invalidated.
        await manager.getGraph(store);
        expect(attempts).toBe(1);
        // Next BUILD tries the worker again (not locked into fallback).
        failToggle.fail = false;
        store.bulkTouch();
        const again = await manager.getGraph(store);
        expect(attempts).toBe(2);
        expect(again.cancelled ?? false).toBe(false);
        if (!again.cancelled) expect(again.fallback).toBe(false);
    });
});

describe('KnnGraphManager dispose', () => {
    it('11. dispose during an in-flight build settles the awaited promise (no hung await)', async () => {
        const { manager, workers } = makeManager({ auto: false });
        const store = seedStore();
        const pending = manager.getGraph(store);
        await settle();
        expect(workers).toHaveLength(1);
        manager.dispose();
        const outcome = await pending; // must settle — a hang fails via timeout
        expect(outcome.cancelled).toBe(true);
        expect(workers[0].terminated).toBe(true);
    });
});

// ── real-store fixture (test 7) ─────────────────────────────────────────────

let SQL: SqlJsStatic;
let realStore: SQLiteStore;
const memAdapter = (): PersistAdapter => ({
    read: async () => null,
    write: async () => { /* in-memory */ },
    exists: async () => false,
});

beforeAll(async () => {
    SQL = await initSqlJs();
    void SQL;
    const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm');
    realStore = await SQLiteStore.open(memAdapter(), 'test.db', new Uint8Array(wasm));
});

function seedReal(store: SQLiteStore, path: string, vec: Float32Array): void {
    store.upsertNote({
        path, mtime: 1, title: path, description: null, tier: 'hot',
        bodyVec: vec, bodyDim: vec.length, indexedAt: 1, descVec: null,
    });
    store.upsertChunks(path, [{ notePath: path, chunkIndex: 0, content: `內容 ${path}`, vec }]);
}
