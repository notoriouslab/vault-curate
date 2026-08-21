// 019 D1: find index rows whose file is gone from the vault.
//
// Deleted-outside-Obsidian notes leave "ghost" rows: no `delete` event ever
// fires, so nothing prunes them (issue #13). The judgment is pure — which
// stored paths no longer exist — and the answer to "does it exist" is
// injected, because that is the only Obsidian-facing half.
//
// The predicate is the whole contract: this function NEVER normalizes case,
// trims, or re-encodes a path. On a case-insensitive filesystem "A/b.md" and
// "a/B.md" are the same file but different keys in Obsidian's file map, and
// only the injected lookup gets to decide. Callers pass
// `p => vault.getAbstractFileByPath(p) instanceof TFile` — NEVER a list
// filtered by the exclusion settings (that would silently purge a folder the
// user merely excluded, and re-including it costs a full re-embed).

/** Stored paths with no live file, in input order. */
export function findStalePaths(
    storedPaths: Iterable<string>,
    exists: (path: string) => boolean,
): string[] {
    const out: string[] = [];
    for (const path of storedPaths) {
        if (!exists(path)) out.push(path);
    }
    return out;
}

// A reconcile that would delete most of the index is far more likely to be a
// broken premise than a real mass deletion: the pass trusts Obsidian's
// in-memory file list, and a list that is empty or half-populated turns every
// live note into a "ghost". The empty case is caught by the caller; this is
// the half case. Refusing costs the user a stale index until they run Update
// index by hand; not refusing costs them a full re-embed of the vault.
//
// This CANNOT distinguish a partial load from someone genuinely deleting most
// of their vault outside Obsidian — no threshold can. It bounds the blast
// radius of the worst case, and it says so out loud instead of acting.
const WIPE_RATIO = 0.5;
const WIPE_MIN_ROWS = 100;

/** True when pruning `staleCount` of `totalRows` looks like a broken premise
 *  rather than a real deletion. Both bounds must trip: the ratio (most of the
 *  index) and an absolute floor (a 20-note vault losing 15 notes is ordinary). */
export function isImplausibleWipe(staleCount: number, totalRows: number): boolean {
    if (totalRows <= 0) return false;
    if (staleCount < WIPE_MIN_ROWS) return false;
    return staleCount / totalRows >= WIPE_RATIO;
}
