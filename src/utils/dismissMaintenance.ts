// 013 D7: keep the dismissed records honest across rename/delete. Same
// family as the orphan-chunk fix that preceded this change: a path-keyed
// store that nobody maintains silently rots — renamed pairs "come back",
// deleted notes leave dead entries forever.
//
// Both handlers must cover TWO shapes (D7): the vault 'rename'/'delete'
// events fire ONCE for a folder with the folder's path, which equals no
// note path — so exact match alone would strand every note underneath.
// The prefix branch compares against `oldPath + "/"` (never a bare
// startsWith, which would also hit sibling folders sharing the prefix,
// e.g. 筆記 vs 筆記本).

import { pairKey, unpairKey } from "./pairKey";

function mapPath(path: string, oldPath: string, newPath: string): string {
    if (path === oldPath) return newPath;
    if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
    return path;
}

function pathMatches(path: string, target: string): boolean {
    return path === target || path.startsWith(target + "/");
}

/** Rewrite every entry touched by a rename (file or folder). Keys are
 *  re-canonicalized (the pair order may flip); on collision the EARLIER
 *  dismissedAt wins — the older judgment stands. */
export function renameInDismissed(
    pairs: Record<string, number>,
    notes: Record<string, number>,
    oldPath: string,
    newPath: string,
): { pairs: Record<string, number>; notes: Record<string, number> } {
    const outPairs: Record<string, number> = {};
    for (const [key, at] of Object.entries(pairs)) {
        const [a, b] = unpairKey(key);
        const next = pairKey(mapPath(a, oldPath, newPath), mapPath(b, oldPath, newPath));
        const existing = outPairs[next];
        outPairs[next] = existing === undefined ? at : Math.min(existing, at);
    }
    const outNotes: Record<string, number> = {};
    for (const [path, at] of Object.entries(notes)) {
        const next = mapPath(path, oldPath, newPath);
        const existing = outNotes[next];
        outNotes[next] = existing === undefined ? at : Math.min(existing, at);
    }
    return { pairs: outPairs, notes: outNotes };
}

/** Drop every entry containing the deleted path (file or folder). */
export function deleteFromDismissed(
    pairs: Record<string, number>,
    notes: Record<string, number>,
    path: string,
): { pairs: Record<string, number>; notes: Record<string, number> } {
    const outPairs: Record<string, number> = {};
    for (const [key, at] of Object.entries(pairs)) {
        const [a, b] = unpairKey(key);
        if (pathMatches(a, path) || pathMatches(b, path)) continue;
        outPairs[key] = at;
    }
    const outNotes: Record<string, number> = {};
    for (const [notePath, at] of Object.entries(notes)) {
        if (pathMatches(notePath, path)) continue;
        outNotes[notePath] = at;
    }
    return { pairs: outPairs, notes: outNotes };
}
