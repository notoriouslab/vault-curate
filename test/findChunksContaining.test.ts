import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { SQLiteStore, type PersistAdapter } from '../src/storage/SQLiteStore';

const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));
const memAdapter: PersistAdapter = {
    read: async () => null,
    write: async () => { /* in-memory */ },
    exists: async () => false,
};
const VEC = new Float32Array([1, 0]);

describe('findChunksContaining (038 D4)', () => {
    let store: SQLiteStore;
    beforeAll(async () => {
        store = await SQLiteStore.open(memAdapter, 'find.db', wasmBytes());
        const note = (path: string, chunks: string[]) => {
            store.upsertNote({
                path, mtime: 1, title: path, description: null, tier: 'hot',
                bodyVec: VEC, bodyDim: 2, indexedAt: 1, descVec: null,
            });
            store.upsertChunks(path, chunks.map((content, chunkIndex) => ({ notePath: path, chunkIndex, content, vec: VEC })));
        };
        note('a.md', ['a.md\n今天去台北車站', 'a.md\n## 建議優先順序\n內容']);
        note('b.md', ['b.md\nThe Plan is ready', 'b.md\n100% 完成 a_b']);
    });

    it('finds CJK text, with note path and chunk index, in order', () => {
        expect(store.findChunksContaining('台北車站')).toEqual([
            { notePath: 'a.md', chunkIndex: 0, content: 'a.md\n今天去台北車站' },
        ]);
    });

    it('folds ASCII case', () => {
        expect(store.findChunksContaining('plan').map(r => r.notePath)).toEqual(['b.md']);
    });

    it('returns nothing for a miss or an empty needle', () => {
        expect(store.findChunksContaining('高鐵')).toEqual([]);
        expect(store.findChunksContaining('')).toEqual([]);
    });

    it('treats % and _ literally', () => {
        expect(store.findChunksContaining('0%').map(r => r.chunkIndex)).toEqual([1]);
        expect(store.findChunksContaining('a_b').map(r => r.notePath)).toEqual(['b.md']);
        expect(store.findChunksContaining('a%b')).toEqual([]);
    });

    it('can keep only chunks that contain a heading marker', () => {
        expect(store.findChunksContaining('建議優先順序', { headingOnly: true }).map(r => r.chunkIndex)).toEqual([1]);
        expect(store.findChunksContaining('台北車站', { headingOnly: true })).toEqual([]);
    });
});
