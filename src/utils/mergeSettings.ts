import type { VaultSearchSettings } from "../types";

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
    merged.dismissedPairs = sanitizeRecord(merged.dismissedPairs);
    merged.dismissedNotes = sanitizeRecord(merged.dismissedNotes);
    return merged;
}
