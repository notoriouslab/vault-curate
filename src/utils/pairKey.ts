/** Canonical key for an unordered note-pair (013 D2). Separator is \n:
 *  Obsidian file names cannot contain a newline, so no collision risk.
 *  Single source of truth — semanticPath, promote, expandCanvas and the
 *  dismissed-pairs store all derive their keys here so the formats can
 *  never silently diverge. */
export function pairKey(a: string, b: string): string {
    return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** Split a pair key back into its two paths (sorted order). Used by the
 *  dismissed-suggestions management modal for display. Defensive: a key
 *  without a separator yields [key, ""] rather than throwing. */
export function unpairKey(key: string): [string, string] {
    const i = key.indexOf('\n');
    return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)];
}
