// 013 D3: drop dismissed suggestions from a score-ordered candidate list.
// Both filters run BEFORE truncation (inside the producing function, not at
// call sites), so a dismissed entry's slot is refilled by the next-ranked
// candidate instead of shrinking the result list. Pure functions — settings
// records ride in as plain data, keeping this module Obsidian-free.

import { pairKey } from "../utils/pairKey";

/** Drop results whose pair (anchor ↔ result) the user dismissed. */
export function filterDismissedPairs<T extends { path: string }>(
    results: T[],
    anchorPath: string,
    dismissed: Record<string, number> | undefined,
): T[] {
    if (!dismissed || Object.keys(dismissed).length === 0) return results;
    return results.filter((r) => dismissed[pairKey(anchorPath, r.path)] === undefined);
}

/** Drop dismissed single notes (global discover — no anchor, 013 D1). */
export function filterDismissedNotes<T extends { path: string }>(
    results: T[],
    dismissed: Record<string, number> | undefined,
): T[] {
    if (!dismissed || Object.keys(dismissed).length === 0) return results;
    return results.filter((r) => dismissed[r.path] === undefined);
}
