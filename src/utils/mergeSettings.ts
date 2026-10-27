import type { VaultSearchSettings } from "../types";
import { normalizeAiOutputLanguage } from "./aiOutputLanguage";
import { keyText } from "./resolveLlmApiKey";

/** Keep only string-key → finite-number entries (same tamper defence as
 *  the selfWrites ledger in loadSettings). A hand-edited data.json where
 *  dismissedPairs is an array/string would otherwise spread into junk
 *  index-keys with non-timestamp values (red-team W1/W2). */
function sanitizeRecord(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
}

/** Merge saved settings over defaults (013 Task 2, extracted from
 *  loadSettings for testability). Mirrors the historical behaviour:
 *  Object.assign fills missing keys only, so existing users keep their
 *  saved values. Non-object input falls back to pure defaults.
 *
 *  The two dismissed records are re-created afterwards: Object.assign is
 *  a shallow merge, so a data.json missing those keys would otherwise
 *  hand out DEFAULT_SETTINGS' own objects — and 013 mutates them in
 *  place (`dismissedPairs[key] = ...`), which would dirty the module
 *  constant (D1 淺拷貝陷阱). */
export function mergeSettings(rawSettings: unknown, defaults: VaultSearchSettings): VaultSearchSettings {
    const saved = (rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings))
        ? rawSettings as Partial<VaultSearchSettings>
        : undefined;
    const merged = Object.assign({}, defaults, saved);
    // 042 D1: no saved settings means a new install (Onboarding still due);
    // saved settings without the field predate 042 and were set up already.
    merged.onboardingDone = saved === undefined
        ? false
        : typeof saved.onboardingDone === "boolean" ? saved.onboardingDone : true;
    merged.dismissedPairs = sanitizeRecord(merged.dismissedPairs);
    merged.dismissedNotes = sanitizeRecord(merged.dismissedNotes);
    // 036 D6: a hand-edited value outside the list falls back to "auto";
    // the custom name is kept as typed (sanitised only when used).
    merged.aiOutputLanguage = normalizeAiOutputLanguage(merged.aiOutputLanguage);
    if (typeof merged.aiOutputLanguageCustom !== "string") merged.aiOutputLanguageCustom = "";
    // 039: same treatment for the model download source and its URL.
    if (merged.modelDownloadSource !== "custom") merged.modelDownloadSource = "huggingface";
    if (typeof merged.modelDownloadUrl !== "string") merged.modelDownloadUrl = "";
    // 041 D3: two keys. Normalise the old key fields first (a hand-edited
    // null would otherwise throw below), then copy the key once for users
    // whose AI curation already points at its own server, so nobody's
    // curation starts failing with 401 after the upgrade. Copy only, never
    // clear apiKey: 1.14.x still reads it after a downgrade.
    merged.apiKey = keyText(merged.apiKey);
    merged.llmUrl = keyText(merged.llmUrl);
    if (saved && !("llmApiKey" in saved)) {
        merged.llmApiKey = merged.llmUrl !== "" && merged.apiKey !== "" ? merged.apiKey : "";
    } else {
        merged.llmApiKey = keyText(merged.llmApiKey);
    }
    return merged;
}
