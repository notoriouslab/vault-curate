/**
 * 042: when the first-launch Onboarding may appear.
 *
 * Only on desktop, only without an index, and only while the user has not
 * answered it yet. People with saved settings use the settings page instead:
 * re-running Onboarding over existing settings is what broke them (042 P2-P11).
 */
export function shouldShowOnboarding(s: { onboardingDone: boolean; indexed: boolean; mobile: boolean }): boolean {
    return !s.mobile && !s.indexed && !s.onboardingDone;
}
