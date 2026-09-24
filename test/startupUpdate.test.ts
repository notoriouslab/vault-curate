import { describe, it, expect } from 'vitest';
import { needsStartupUpdate } from '../src/utils/startupUpdate';

const idle = {
    indexed: true,
    isMobile: false,
    denoiseStale: false,
    t2sStale: false,
    descPending: false,
    chunkState: 'none' as const,
};

describe('needsStartupUpdate', () => {
    it('is false when nothing is pending', () => {
        expect(needsStartupUpdate(idle)).toBe(false);
    });

    it('is true for a stale denoise version', () => {
        expect(needsStartupUpdate({ ...idle, denoiseStale: true })).toBe(true);
    });

    it('is true for a stale t2s version', () => {
        expect(needsStartupUpdate({ ...idle, t2sStale: true })).toBe(true);
    });

    it('is true for pending description backfill', () => {
        expect(needsStartupUpdate({ ...idle, descPending: true })).toBe(true);
    });

    it('is true when chunks need a re-embed', () => {
        expect(needsStartupUpdate({ ...idle, chunkState: 'reembed' })).toBe(true);
    });

    it('is false for stamp-only (the caller writes the stamp without an update)', () => {
        expect(needsStartupUpdate({ ...idle, chunkState: 'stamp-only' })).toBe(false);
    });

    it('is false without an index or on mobile, whatever is pending', () => {
        const pending = { ...idle, denoiseStale: true, chunkState: 'reembed' as const };
        expect(needsStartupUpdate({ ...pending, indexed: false })).toBe(false);
        expect(needsStartupUpdate({ ...pending, isMobile: true })).toBe(false);
    });
});
