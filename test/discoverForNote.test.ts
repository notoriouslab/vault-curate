import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';
import { discoverForNoteSqlite, findSimilarSqlite } from '../src/search/discoverSqlite';

const adapter: PersistAdapter = {
    read: async () => null,
    write: async () => { /* in-memory */ },
    exists: async () => false,
};

let store: SQLiteStore;

function unit(dim: number, hot: number): Float32Array {
    const spread = Math.sqrt(1 - hot * hot);
    const v = new Float32Array(dim);
    v[0] = hot;
    v[1] = spread;
    return v;
}

beforeAll(async () => {
    const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm');
    store = await SQLiteStore.open(adapter, 'discover-test.db', new Uint8Array(wasm));
    const mk = (path: string, cos: number, tier: 'hot' | 'cold', vec?: Float32Array) => {
        store.upsertNote({
            path, mtime: 1, title: path, description: null, tier,
            bodyVec: vec ?? unit(4, cos), bodyDim: 4, indexedAt: 1, descVec: null,
        });
    };
    mk('anchor.md', 1.0, 'hot');
    mk('hot-close.md', 0.95, 'hot');
    mk('cold-mid.md', 0.90, 'cold');
    mk('hot-mid.md', 0.85, 'hot');
    mk('cold-far.md', 0.80, 'cold');
    mk('below-min.md', 0.10, 'cold');
    // NaN-poisoned vector: cosine against it is NaN (regression review C1).
    mk('nan-note.md', 0.99, 'cold', new Float32Array([NaN, 0, 0, 0]));
});

const SETTINGS = { minScore: 0.5, topResults: 10 };

describe('discoverForNoteSqlite (current-note Discover contract)', () => {
    it('ranks purely by score with hot/cold interleaved — no cold-first block (主公 2026-07-23)', async () => {
        const out = await discoverForNoteSqlite('anchor.md', store, { ...SETTINGS });
        expect(out.map(r => r.path)).toEqual([
            'hot-close.md', 'cold-mid.md', 'hot-mid.md', 'cold-far.md',
        ]);
    });

    it('excludes NaN-scored notes instead of letting them poison the sort', async () => {
        const out = await discoverForNoteSqlite('anchor.md', store, { ...SETTINGS });
        expect(out.map(r => r.path)).not.toContain('nan-note.md');
    });

    it('applies minScore before anything else', async () => {
        const out = await discoverForNoteSqlite('anchor.md', store, { ...SETTINGS });
        expect(out.map(r => r.path)).not.toContain('below-min.md');
    });

    it('kwRank reorders within the pool (fusion) without pulling in filtered notes', async () => {
        const out = await discoverForNoteSqlite('anchor.md', store, {
            ...SETTINGS,
            kwRank: new Map([['cold-far.md', 1], ['below-min.md', 2]]),
        });
        expect(out[0].path).toBe('cold-far.md');
        expect(out.map(r => r.path)).not.toContain('below-min.md');
    });

    it('empty kwRank keeps the pure cosine order', async () => {
        const plain = await discoverForNoteSqlite('anchor.md', store, { ...SETTINGS });
        const fusedEmpty = await discoverForNoteSqlite('anchor.md', store, {
            ...SETTINGS, kwRank: new Map(),
        });
        expect(fusedEmpty.map(r => r.path)).toEqual(plain.map(r => r.path));
    });
});

/**
 * 019 D5: index rows outlive their file when a note is deleted outside
 * Obsidian (issue #13). These two producers feed persisted artifacts
 * (relation graph / expand write `file` nodes into a .canvas), so a ghost
 * here is worse than a dead click — it lands in a saved file.
 */
describe('exists 過濾（019 D5）', () => {
    const alive = (path: string) => path !== 'cold-mid.md';

    it('控制組：不傳 exists 時 cold-mid.md 在結果內（證明斷言有在咬）', async () => {
        const out = await discoverForNoteSqlite('anchor.md', store, { ...SETTINGS });
        expect(out.map(r => r.path)).toContain('cold-mid.md');
    });

    it('discoverForNote：幽靈被濾掉，其餘排序不變', async () => {
        const out = await discoverForNoteSqlite('anchor.md', store, { ...SETTINGS, exists: alive });
        expect(out.map(r => r.path)).toEqual(['hot-close.md', 'hot-mid.md', 'cold-far.md']);
    });

    it('findSimilar：幽靈被濾掉，且不佔 topResults 名額', async () => {
        const capped = findSimilarSqlite('anchor.md', store, { ...SETTINGS, topResults: 2 });
        expect(capped.map(r => r.path)).toEqual(['hot-close.md', 'cold-mid.md']);
        const filtered = findSimilarSqlite('anchor.md', store, {
            ...SETTINGS, topResults: 2, exists: alive,
        });
        expect(filtered.map(r => r.path)).toEqual(['hot-close.md', 'hot-mid.md']);
    });

    it('exists 早於 tierResolver——幽靈不會被問 tier', async () => {
        const asked: string[] = [];
        await discoverForNoteSqlite('anchor.md', store, {
            ...SETTINGS,
            exists: alive,
            tierResolver: (p) => { asked.push(p); return 'hot'; },
        });
        expect(asked).toContain('hot-close.md');
        expect(asked).not.toContain('cold-mid.md');
    });
});
