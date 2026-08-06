/**
 * 015 D4: the mobile index-loading gate — a promise-cached single entry for
 * "load the desktop-built index on first query intent".
 *
 * Contract (all three pinned by test/mobileIndexGate.test.ts):
 *   - success is cached: concurrent and later callers share one load;
 *   - failure is NOT cached: a rejected load clears the gate so retry
 *     genuinely retries (G1 audit C1);
 *   - deep-read failures call invalidate(): dispose the store, clear the
 *     gate, mark `failed` — the next attempt re-reads the file, by which
 *     time iCloud has usually finished syncing it (red-team C3).
 *
 * Pure orchestration: Obsidian specifics (stat, openStore, notices) are
 * injected, which is what makes the retry/invalidate semantics unit-testable.
 */
import { indexLoadDecision } from '../utils/indexLoadDecision';

export type MobileGateState = 'idle' | 'loading' | 'ready' | 'failed' | 'too-large';

/** Minimal store surface the gate needs (dispose on invalidate). */
type DisposableStore = { dispose(): Promise<void> };

export type MobileGateDeps<S extends DisposableStore> = {
    /** File size of the index, or null when unknown (stat failed). */
    statSize: () => Promise<number | null>;
    /** Actually open the store (read-only; supplied by main.ts). */
    openStore: () => Promise<S>;
    /** Fired once if loading is still running after `slowLoadMs`. */
    onSlowLoad?: () => void;
    slowLoadMs?: number;
};

export class MobileIndexGate<S extends DisposableStore> {
    state: MobileGateState = 'idle';
    /** MB figure for the too-large message (0 until that state is hit). */
    lastTooLargeMb = 0;

    private gate: Promise<S> | null = null;
    private loaded: S | null = null;
    /** Review C2: bumped by invalidate(); an in-flight load whose generation
     *  no longer matches was superseded — it must dispose its store and
     *  reject instead of overwriting the fresh state (stale-load-wins race:
     *  reload during a slow iCloud first-download would otherwise silently
     *  revert to the pre-reload snapshot and leak the fresh store). */
    private generation = 0;

    constructor(private readonly deps: MobileGateDeps<S>) {}

    ensureLoaded(): Promise<S> {
        if (this.gate) return this.gate;
        this.gate = this.load();
        // Failure is not cached — clear the gate so the next call retries.
        this.gate.catch(() => { /* handled per-generation inside load() */ });
        return this.gate;
    }

    /** Deep-read failure (torn iCloud file passed open(), then a query hit a
     *  corrupt page) or an explicit reload: drop everything so the next
     *  attempt re-reads the file. Supersedes any in-flight load. */
    async invalidate(): Promise<void> {
        this.generation++;
        const store = this.loaded;
        this.loaded = null;
        this.gate = null;
        this.state = 'failed';
        if (store) await store.dispose();
    }

    private async load(): Promise<S> {
        const gen = ++this.generation;
        this.state = 'loading';
        const slowTimer = window.setTimeout(
            () => this.deps.onSlowLoad?.(),
            this.deps.slowLoadMs ?? 3000,
        );
        try {
            const size = await this.deps.statSize();
            if (indexLoadDecision(size) === 'too-large') {
                this.state = 'too-large';
                this.lastTooLargeMb = Math.round((size ?? 0) / 1048576);
                throw new Error(`index too large for mobile: ${this.lastTooLargeMb} MB`);
            }
            const store = await this.deps.openStore();
            if (gen !== this.generation) {
                // Superseded while awaiting — a newer load owns the state now.
                await store.dispose();
                throw new Error('index load superseded by a newer reload');
            }
            this.loaded = store;
            this.state = 'ready';
            return store;
        } catch (e) {
            if (gen === this.generation) {
                if (this.state !== 'too-large') this.state = 'failed';
                this.gate = null; // failure is not cached — retry re-loads
            }
            throw e;
        } finally {
            window.clearTimeout(slowTimer);
        }
    }
}
