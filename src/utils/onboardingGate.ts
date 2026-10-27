import { DEFAULT_SETTINGS, type VaultSearchSettings } from "../types";
import { keyText } from "./resolveLlmApiKey";

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

/** The fields Onboarding writes, plus the AI curation server it would share.
 *  Onboarding applies its choices only while all of them are still the
 *  defaults (042 D3). */
const BASELINE_TEXT_FIELDS = [
    "embeddingProvider", "ollamaUrl", "ollamaModel", "apiKey", "apiFormat", "llmUrl", "llmApiKey",
] as const;

export function isOnboardingBaseline(s: VaultSearchSettings): boolean {
    if (s.enableAICuration !== DEFAULT_SETTINGS.enableAICuration) return false;
    return BASELINE_TEXT_FIELDS.every((k) => keyText(s[k]) === keyText(DEFAULT_SETTINGS[k]));
}
