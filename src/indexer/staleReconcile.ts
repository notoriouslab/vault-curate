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
