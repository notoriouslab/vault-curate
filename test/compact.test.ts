/**
 * 028: compact() reclaims freelist pages after mass deletions.
 *
 * The scenario this pins: ~2,400 notes moved out of a real vault left an
 * index of 122 rows / 3.4MB of data inside a 75MB file — 95.5% freelist,
 * because DELETE hands pages to the freelist and sql.js never returns them.
 * VACUUM rewrites the image compact IN PLACE (store identity unchanged), so
 * the whole 018 store-swap machinery is unnecessary.
 *
 * Thresholds under test (COMPACT_MIN_FREE_PAGES=256 / COMPACT_MIN_FREE_RATIO=0.2):
 * both sides of each are exercised — a rule with a threshold gets tested on
 * both sides or the threshold is decoration.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { SQLiteStore, type PersistAdapter, type NoteRecord } from '../src/storage/SQLiteStore';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs(); });

const memoryAdapter = () => {
    const state = { writes: 0, last: null as Uint8Array | null };
    const adapter: PersistAdapter = {
        read: async () => state.last,
        write: async (_p, bytes) => { state.writes++; state.last = bytes; },
        exists: async () => state.last !== null,
    };
    return { adapter, state };
};

const note = (i: number): NoteRecord => ({
    path: `n/${i}.md`,
    mtime: 1,
    title: `t${i}`,
    description: null,
    tier: null,
    bodyVec: new Float32Array(512).fill(0.5),
    bodyDim: 512,
    indexedAt: 1,
});

/** Fill with `n` notes, each carrying one fat chunk (~6KB), so mass deletion
 *  leaves a freelist big enough to cross the 256-page (1MiB) floor. */
const fill = (store: SQLiteStore, n: number) => {
    for (let i = 0; i < n; i++) {
        store.upsertNote(note(i));
        store.upsertChunks(`n/${i}.md`, [{
            notePath: `n/${i}.md`,
            chunkIndex: 0,
            content: 'x'.repeat(4096),
            vec: new Float32Array(512).fill(0.25),
        }]);
    }
};

const pragma = (store: SQLiteStore, name: string): number => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (store as any).db;
    return Number(db.exec(`PRAGMA ${name}`)[0].values[0][0]);
};

const openStore = async (bytes: Uint8Array | null = null, readOnly = false) => {
    const { adapter, state } = memoryAdapter();
    state.last = bytes;
    const store = await SQLiteStore.open(adapter, 'test.db', wasmBytes(), { readOnly });
    return { store, state };
};

describe('SQLiteStore.compact (028)', () => {
    it('reclaims a mass-deletion freelist: page_count shrinks, data survives', async () => {
        const { store } = await openStore();
        fill(store, 400);
        for (let i = 0; i < 390; i++) store.deleteNote(`n/${i}.md`);

        const freeBefore = pragma(store, 'freelist_count');
        const totalBefore = pragma(store, 'page_count');
        expect(freeBefore).toBeGreaterThan(256);            // scenario really is past the floor
        expect(freeBefore / totalBefore).toBeGreaterThan(0.2); // and past the ratio

        expect(store.compact()).toBe(true);

        expect(pragma(store, 'freelist_count')).toBe(0);
        expect(pragma(store, 'page_count')).toBeLessThan(totalBefore / 2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = (store as any).db;
        expect(db.exec('PRAGMA quick_check')[0].values[0][0]).toBe('ok');
        expect(db.exec('SELECT COUNT(*) FROM notes')[0].values[0][0]).toBe(10);
        expect(db.exec('SELECT COUNT(*) FROM chunks')[0].values[0][0]).toBe(10);
        expect(store.getNote('n/395.md')?.title).toBe('t395');
        await store.dispose();
    });

    it('persists the compacted image: flushed bytes shrink and reopen intact', async () => {
        const { store, state } = await openStore();
        fill(store, 400);
        await store.flush();
        const fatSize = state.last!.length;

        for (let i = 0; i < 390; i++) store.deleteNote(`n/${i}.md`);
        // Land the deletions BEFORE compacting, so the final flush below has
        // nothing pending except what compact() itself marks dirty — this is
        // what pins compact's own touch(): without it that flush would be a
        // watermark no-op and the fat image would stay on disk.
        await store.flush();
        expect(state.last!.length).toBeGreaterThan(fatSize / 2); // deletion alone frees nothing

        expect(store.compact()).toBe(true);
        await store.flush();
        expect(state.last!.length).toBeLessThan(fatSize / 2);

        const { store: reopened } = await openStore(state.last);
        expect(reopened.getNote('n/399.md')?.title).toBe('t399');
        expect(reopened.getNote('n/0.md')).toBeNull();
        await reopened.dispose();
        await store.dispose();
    });

    it('below the ratio threshold: no-op, revision untouched', async () => {
        const { store } = await openStore();
        fill(store, 400);
        // A light trim: plenty of absolute pages COULD be freed by heavier
        // deletion, but this leaves the ratio under 0.2.
        for (let i = 0; i < 40; i++) store.deleteNote(`n/${i}.md`);
        const free = pragma(store, 'freelist_count');
        const total = pragma(store, 'page_count');
        expect(free / total).toBeLessThanOrEqual(0.2); // guard: scenario is what it claims
        const revBefore = store.getRevision();

        expect(store.compact()).toBe(false);

        expect(pragma(store, 'freelist_count')).toBe(free); // VACUUM really did not run
        expect(store.getRevision()).toBe(revBefore);
        await store.dispose();
    });

    it('below the absolute floor: high ratio on a tiny file is still a no-op', async () => {
        const { store } = await openStore();
        fill(store, 60); // small file
        for (let i = 0; i < 55; i++) store.deleteNote(`n/${i}.md`);
        const free = pragma(store, 'freelist_count');
        const total = pragma(store, 'page_count');
        expect(free / total).toBeGreaterThan(0.2);  // ratio side would fire
        expect(free).toBeLessThanOrEqual(256);      // floor side must veto

        expect(store.compact()).toBe(false);
        expect(pragma(store, 'freelist_count')).toBe(free);
        await store.dispose();
    });

    it('read-only store refuses (mobile must never write)', async () => {
        const { store, state } = await openStore();
        fill(store, 400);
        for (let i = 0; i < 390; i++) store.deleteNote(`n/${i}.md`);
        await store.flush();
        const bytes = state.last!;
        await store.dispose();

        const { store: ro, state: roState } = await openStore(bytes, true);
        expect(ro.compact()).toBe(false);
        await ro.flush(); // read-only flush is a no-op
        expect(roState.writes).toBe(0);
        await ro.dispose();
    });

    it('disposed store refuses', async () => {
        const { store } = await openStore();
        fill(store, 10);
        await store.dispose();
        expect(store.compact()).toBe(false);
    });
});
