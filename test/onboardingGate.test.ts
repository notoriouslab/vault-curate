import { describe, it, expect } from 'vitest';
import { discoverNoIndexState, shouldShowOnboarding } from '../src/utils/onboardingGate';

describe('shouldShowOnboarding', () => {
    it('shows only on desktop, without an index, before the user answered', () => {
        for (const onboardingDone of [false, true]) {
            for (const indexed of [false, true]) {
                for (const mobile of [false, true]) {
                    const expected = !onboardingDone && !indexed && !mobile;
                    expect(shouldShowOnboarding({ onboardingDone, indexed, mobile })).toBe(expected);
                }
            }
        }
    });
});

describe('discoverNoIndexState', () => {
    const store = (indexedAt: string | null) => ({ getMeta: (k: string) => (k === 'last_indexed_at' ? indexedAt : null) });

    it('desktop: no store or nothing indexed yet means "Build index first"', () => {
        expect(discoverNoIndexState(null, false)).toBe('noIndex');
        expect(discoverNoIndexState(store(null), false)).toBe('noIndex');
        expect(discoverNoIndexState(store('2026-10-27T00:00:00Z'), false)).toBeNull();
    });

    it('mobile keeps its own states', () => {
        expect(discoverNoIndexState(undefined, true)).toBe('gate');
        expect(discoverNoIndexState(store(null), true)).toBeNull();
        expect(discoverNoIndexState(store('2026-10-27T00:00:00Z'), true)).toBeNull();
    });
});

