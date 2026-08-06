/**
 * 015 re-review W: the guilt probe must touch meta AND the big tables —
 * partial corruption (meta intact, chunks broken) must read as sick.
 */
import { describe, it, expect } from 'vitest';
import { probeStoreHealth } from '../src/mobile/probeStoreHealth';

const healthy = {
    getMeta: () => '3',
    countChunks: () => 42,
    getAllTitles: () => new Map<string, string>(),
};

describe('probeStoreHealth（015 唯讀防線的判罪探針）', () => {
    it('三讀全過 → 健康', () => {
        expect(probeStoreHealth(healthy)).toBe(true);
    });
    it('meta 完好但 chunks 損毀（部分損毀檔的典型形狀）→ 有病', () => {
        expect(probeStoreHealth({
            ...healthy,
            countChunks: () => { throw new Error('database disk image is malformed'); },
        })).toBe(false);
    });
    it('notes 損毀 → 有病', () => {
        expect(probeStoreHealth({
            ...healthy,
            getAllTitles: () => { throw new Error('database disk image is malformed'); },
        })).toBe(false);
    });
    it('meta 都讀不了 → 有病', () => {
        expect(probeStoreHealth({
            ...healthy,
            getMeta: () => { throw new Error('file is not a database'); },
        })).toBe(false);
    });
});
