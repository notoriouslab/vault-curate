// 014 D7-D10: lifecycle owner for the semantic k-NN graph.
//
// Query path:  getGraph() — revision-aligned resident state answers
//              instantly; anything else costs ONE worker build (with
//              progress + cancel), never a frozen main thread.
// Write path:  onMutation() — millisecond incremental maintenance (D6),
//              with drift-bounded background self-healing (probe014-
//              calibrated 5%) and a hard revision backstop: any mutation
//              that slips past the hooks degrades to "slow once", never
//              to "wrong results" (#108).
//
// Zero Obsidian imports: the worker arrives via an injected factory
// (testable, D10), progress/build-start surface as callbacks, and the
// store is a structural interface.

import {
    type KnnGraph,
    buildKnnPicks,
    graphFromPicks,
    edgeSimPercentile,
    BOTTLENECK_PERCENTILE,
} from './semanticPath';
import {
    type KnnState,
    createKnnState,
    applyNoteUpserted,
    applyNoteRemoved,
    deriveGraph,
    needsRebuild,
} from './knnIncremental';
import { packNotes, unpackPicks, majorityDim } from './knnCodec';

export interface KnnStoreLike {
    getAllNotesLight(): Array<{ path: string; noteVec: Float32Array }>;
    getNoteVec(path: string): Float32Array | null;
    getRevision(): number;
}

export type KnnGraphOutcome =
    | { cancelled: true }
    | { cancelled?: false; graph: KnnGraph; threshold: number; fallback: boolean };

export interface KnnBuildCallbacks {
    /** Fires only when a blocking (user-awaited) build actually starts. */
    onBuildStart?: (total: number) => void;
    onProgress?: (done: number, total: number) => void;
    /** Fires (and is awaited) BEFORE the synchronous fallback build — the
     *  caller must surface a Notice and yield a paint frame, because the
     *  main thread is about to freeze for the O(N²) sweep (G3 red-team C2;
     *  home 紀律: >5s 工作必掛 Notice). */
    onFallback?: () => void | Promise<void>;
}

interface ManagerOpts {
    spawnWorker: () => Worker;
    k: number;
    sameFolderCap: number;
    /** probe014-calibrated drift bound (D6 #7). */
    driftRatio?: number;
    /** Min gap between background self-heal rebuilds (D8 storm backoff). */
    cooldownMs?: number;
    /** Bulk indexing guard — hooks are ignored while true (D8). */
    isBulkIndexing?: () => boolean;
    /** Injectable clock for tests. */
    now?: () => number;
    log?: (msg: string) => void;
}

const DEFAULT_DRIFT_RATIO = 0.05;
const DEFAULT_COOLDOWN_MS = 60_000;

export class KnnGraphManager {
    private state: KnnState | null = null;
    private graph: KnnGraph | null = null;
    private threshold = 0;
    private lastSyncedRevision = -1;
    private lastStore: KnnStoreLike | null = null;

    private inFlight: Promise<KnnGraphOutcome> | null = null;
    private inFlightIsRefresh = false;
    /** Mutations hooked while a build is in flight. `rev` is the store
     *  revision AT HOOK TIME (post-mutation): alignment after the swap
     *  takes max(revAtPack, queue revs) so a concurrent hook-suppressed
     *  bulk can never be silently absorbed — the backstop catches it. */
    private queue: Array<{ type: 'upsert' | 'remove'; path: string; rev: number }> = [];
    /** Settles the awaited build promise on user cancel. */
    private resolveCancelled: (() => void) | null = null;
    /** Build generation — bumped on cancel/dispose/swap so a late worker
     *  message can never apply a stale payload (D8 訊息競態). */
    private generation = 0;
    private worker: Worker | null = null;

    private lastRebuildDoneAt = Number.NEGATIVE_INFINITY;
    private pendingRebuild = false;
    private disposed = false;
    /** Graph/threshold lag behind state until the next query (四路總檢
     *  紅隊 W2): deriving eagerly per mutation costs ~23ms each — a sync
     *  storm of hundreds of files would stack seconds of main-thread work
     *  for graphs nobody is looking at. Lazy: apply is ~2ms, the one
     *  derive (~20ms) happens at query time, imperceptibly. */
    private graphDirty = false;

    constructor(private opts: ManagerOpts) {}

    private get driftRatio(): number { return this.opts.driftRatio ?? DEFAULT_DRIFT_RATIO; }
    private get cooldownMs(): number { return this.opts.cooldownMs ?? DEFAULT_COOLDOWN_MS; }
    private now(): number { return this.opts.now ? this.opts.now() : Date.now(); }
    private log(msg: string): void { (this.opts.log ?? ((m: string) => console.debug(m)))(`vault-curate knn: ${msg}`); }

    /** The graph for the semantic-path command. Resolves instantly when the
     *  resident state is trusted; otherwise runs one worker build. */
    async getGraph(store: KnnStoreLike, cb?: KnnBuildCallbacks): Promise<KnnGraphOutcome> {
        if (this.inFlight) {
            if (this.inFlightIsRefresh && this.state) {
                // Background self-heal in progress — old state keeps serving.
                this.ensureDerived();
                return { graph: this.graph!, threshold: this.threshold, fallback: false };
            }
            return this.inFlight;
        }
        if (
            this.state &&
            this.lastStore === store &&
            !this.state.needsFullRebuild &&
            store.getRevision() === this.lastSyncedRevision
        ) {
            this.ensureDerived();
            return { graph: this.graph!, threshold: this.threshold, fallback: false };
        }
        // Untrusted (unbuilt / store swapped / bulk bypassed hooks / dim flag):
        // discard and rebuild while the caller waits — with progress + cancel.
        if (this.state) this.log('backstop: resident state untrusted, full rebuild');
        this.clearState();
        this.inFlightIsRefresh = false;
        this.inFlight = this.buildBlocking(store, cb);
        try {
            return await this.inFlight;
        } finally {
            this.inFlight = null;
        }
    }

    /** Indexer hook (D8). Four branches — see design/tasks. */
    onMutation(type: 'upsert' | 'remove', path: string, store: KnnStoreLike): void {
        if (this.disposed) return;
        if (this.opts.isBulkIndexing?.()) return; // bulk → backstop cleans up
        if (this.inFlight) {
            this.queue.push({ type, path, rev: store.getRevision() });
            if (this.inFlightIsRefresh && this.state) {
                // Background rebuild: ALSO apply live so queries stay fresh.
                this.applyMutation(type, path, store);
            }
            return;
        }
        if (!this.state) return; // never built — nothing to maintain
        this.applyMutation(type, path, store);
        this.lastSyncedRevision = store.getRevision(); // overwrite, NEVER ++ (touch multiplier)
        this.maybeScheduleRefresh(store);
    }

    /** Cancel a user-awaited build (Notice button). */
    cancel(): void {
        if (!this.inFlight || this.inFlightIsRefresh) return;
        this.generation++;
        this.terminateWorker();
        this.clearState();
        this.queue = [];
        this.resolveCancelled?.(); // settle the awaited promise (never hang)
        this.resolveCancelled = null;
        this.log('build cancelled by user');
    }

    dispose(): void {
        this.disposed = true;
        this.generation++;
        this.terminateWorker();
        this.clearState();
        this.queue = [];
        // Settle any USER-AWAITED (foreground) build — without this,
        // unloading the plugin mid-build leaves buildSemanticPathCanvas
        // hanging on the await and its sticky Notice on screen forever (G3
        // red-team C1). A background refresh promise has no such hook and
        // stays pending — benign garbage: nothing awaits it after unload,
        // and re-enabling the plugin constructs a fresh manager (四路總檢
        // 紅隊記錄級 #1).
        this.resolveCancelled?.();
        this.resolveCancelled = null;
    }

    // ── Internals ──────────────────────────────────────────────────────────

    private clearState(): void {
        this.state = null;
        this.graph = null;
        this.threshold = 0;
        this.lastSyncedRevision = -1;
        this.lastStore = null;
        this.graphDirty = false;
    }

    private terminateWorker(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    private applyMutation(type: 'upsert' | 'remove', path: string, store: KnnStoreLike): void {
        if (!this.state) return;
        if (type === 'remove') {
            applyNoteRemoved(this.state, path);
        } else {
            const vec = store.getNoteVec(path);
            if (vec === null) {
                // Not in the index ⇒ not in the graph — the store is the
                // single source of truth. NB (red-team W1): a note EDITED to
                // empty keeps its previous vector in the store (indexOne
                // returns false without touching it, a pre-014 semantic
                // shared with Find Similar), so this branch only fires for
                // paths that were never indexed.
                applyNoteRemoved(this.state, path);
            } else {
                applyNoteUpserted(this.state, path, vec, this.opts.k, this.opts.sameFolderCap);
            }
        }
        this.graphDirty = true; // derived lazily at the next query
    }

    /** Re-derive graph + p45 threshold from the state when stale (D6 #6,
     *  lazy since the 四路總檢 round). */
    private ensureDerived(): void {
        if (!this.state) return;
        if (this.graph && !this.graphDirty) return;
        this.graph = deriveGraph(this.state);
        this.threshold = edgeSimPercentile(this.graph, BOTTLENECK_PERCENTILE);
        this.graphDirty = false;
    }

    private maybeScheduleRefresh(store: KnnStoreLike): void {
        if (!this.state) return;
        if (!needsRebuild(this.state, this.driftRatio) && !this.pendingRebuild) return;
        if (this.inFlight) { this.pendingRebuild = true; return; }
        if (this.now() - this.lastRebuildDoneAt < this.cooldownMs) {
            this.pendingRebuild = true; // cooldown — picked up on later activity
            return;
        }
        this.pendingRebuild = false;
        this.inFlightIsRefresh = true;
        this.log(`drift self-heal rebuild scheduled (${this.state.changedSinceBuild.size} changed)`);
        this.inFlight = this.buildInWorker(store, undefined, true)
            .catch((e) => {
                // Background failure: keep the old state serving (D8/D10).
                this.log(`background rebuild failed, keeping current state: ${String(e)}`);
                return { cancelled: true as const };
            })
            .finally(() => {
                this.inFlight = null;
                this.inFlightIsRefresh = false;
                this.lastRebuildDoneAt = this.now();
            });
    }

    /** User-awaited build: worker first, sync fallback on spawn failure. */
    private async buildBlocking(store: KnnStoreLike, cb?: KnnBuildCallbacks): Promise<KnnGraphOutcome> {
        try {
            return await this.buildInWorker(store, cb, false);
        } catch (e) {
            this.resolveCancelled = null;
            // D10: someone is waiting — degrade to the 1.4.0 sync path, loudly.
            console.warn('vault-curate: knn worker failed, falling back to synchronous build', e);
            this.queue = [];
            // Let the caller paint a Notice before the freeze (red-team C2).
            await cb?.onFallback?.();
            const rows = store.getAllNotesLight();
            const dim = majorityDim(rows); // order-independent (紅隊 W3)
            const packed = packNotes(rows, dim);
            const notes = packed.paths.map((p, i) => ({
                path: p,
                vec: packed.matrix.subarray(i * dim, (i + 1) * dim),
            }));
            // ONE O(N²) sweep: picks feed the graph AND the resident state
            // (audit blocking #2 — the naive version built twice).
            const picks = buildKnnPicks(notes, this.opts.k, this.opts.sameFolderCap);
            const graph = graphFromPicks(picks);
            const threshold = edgeSimPercentile(graph, BOTTLENECK_PERCENTILE);
            this.state = createKnnState(notes, this.opts.k, this.opts.sameFolderCap, picks);
            this.graph = graph;
            this.threshold = threshold;
            this.lastStore = store;
            this.lastSyncedRevision = store.getRevision();
            return { graph, threshold, fallback: true };
        }
    }

    private buildInWorker(
        store: KnnStoreLike,
        cb: KnnBuildCallbacks | undefined,
        isRefresh: boolean,
    ): Promise<KnnGraphOutcome> {
        // Revision BEFORE packing: alignment after the swap must never
        // absorb mutations the hooks did not see (concurrent bulk).
        const revAtPack = store.getRevision();
        const rows = store.getAllNotesLight();
        const dim = majorityDim(rows); // order-independent (紅隊 W3)
        const packed = packNotes(rows, dim);
        const total = packed.paths.length;
        const buildGeneration = ++this.generation;

        return new Promise<KnnGraphOutcome>((resolve, reject) => {
            let worker: Worker;
            try {
                worker = this.opts.spawnWorker();
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
            }
            this.worker = worker;
            if (!isRefresh) {
                this.resolveCancelled = () => resolve({ cancelled: true });
                cb?.onBuildStart?.(total);
            }

            worker.onerror = (event) => {
                if (buildGeneration !== this.generation) return;
                this.terminateWorker();
                reject(new Error(event.message || 'knn worker error'));
            };
            worker.onmessage = (event: MessageEvent) => {
                if (buildGeneration !== this.generation) return; // stale (D8 token)
                const msg = event.data as
                    | { type: 'knn-progress'; done: number; total: number }
                    | { type: 'knn-done'; pickCounts: Int32Array; pickTargets: Int32Array; pickSims: Float64Array; matrixBuffer: ArrayBuffer }
                    | { type: 'knn-error'; message: string };
                if (msg.type === 'knn-progress') {
                    if (!isRefresh) cb?.onProgress?.(msg.done, msg.total);
                    return;
                }
                if (msg.type === 'knn-error') {
                    this.terminateWorker();
                    reject(new Error(msg.message));
                    return;
                }
                // knn-done → atomic swap + queue replay + revision alignment.
                this.terminateWorker();
                const picks = unpackPicks(msg.pickCounts, msg.pickTargets, msg.pickSims, packed.paths);
                const matrix = new Float32Array(msg.matrixBuffer);
                const state = createKnnState(
                    packed.paths.map((p, i) => ({
                        path: p,
                        vec: matrix.subarray(i * dim, (i + 1) * dim),
                    })),
                    this.opts.k,
                    this.opts.sameFolderCap,
                    picks,
                );
                this.state = state;
                this.lastStore = store;
                const replay = this.queue;
                this.queue = [];
                this.graphDirty = true;
                for (const m of replay) this.applyMutation(m.type, m.path, store);
                this.ensureDerived(); // ONE derive covering swap + replay
                // max(pack-time, hook-time) — NEVER the current revision: a
                // hook-suppressed bulk that landed mid-build must show up as
                // a mismatch at the next query (slow once, not wrong).
                this.lastSyncedRevision = replay.reduce((r, m) => Math.max(r, m.rev), revAtPack);
                this.resolveCancelled = null;
                this.log(`graph built in worker (${total} notes${replay.length ? `, replayed ${replay.length}` : ''})`);
                resolve({ graph: this.graph!, threshold: this.threshold, fallback: false });
            };

            const matrixBuffer = packed.matrix.buffer;
            worker.postMessage(
                {
                    type: 'knn-build',
                    matrixBuffer,
                    dim,
                    paths: packed.paths,
                    k: this.opts.k,
                    sameFolderCap: this.opts.sameFolderCap,
                },
                [matrixBuffer],
            );
        });
    }
}
