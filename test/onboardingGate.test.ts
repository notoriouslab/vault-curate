import { describe, it, expect } from 'vitest';
import { shouldShowOnboarding } from '../src/utils/onboardingGate';

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
