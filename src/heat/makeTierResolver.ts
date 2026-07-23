// Query-time TierResolver factory (010 D5) — the Obsidian-facing half of
// src/heat. One resolver is built per query: the incoming-link Set and
// `now` are true snapshots; resolved/unresolved are live metadataCache
// references (a cache update mid-query can shift hasOutgoing for a
// not-yet-memoized path — per-path memoization keeps each note's answer
// stable within the query). The SQLite `notes.tier` column remains as an
// advisory fallback for callers that don't inject a resolver.

import { App, TFile } from "obsidian";
import { deriveTier, type TierResolver } from "./deriveTier";

function hasEntries(rec: Record<string, number> | undefined): boolean {
    if (!rec) return false;
    for (const _ in rec) return true;
    return false;
}

/** frontmatter `created` when present, else fs ctime — mirrors the
 *  indexer's computeTier resolution so advisory and derived tiers agree. */
export function resolveCreated(app: App, file: TFile): number {
    // Annotation, not assertion — the shape the Dashboard audit accepts
    // (v1.1.1: one move clears both unsafe-any and unnecessary-assertion).
    const fm: Record<string, unknown> | undefined =
        app.metadataCache.getFileCache(file)?.frontmatter;
    const created = fm?.created;
    if (typeof created === "string" || typeof created === "number") {
        const ts = new Date(created).getTime();
        if (Number.isFinite(ts)) return ts;
    }
    return file.stat.ctime;
}

export function makeTierResolver(
    app: App,
    selfWrites: Record<string, number>,
    hotDays: number,
): TierResolver {
    const now = Date.now();
    const resolved = app.metadataCache.resolvedLinks;
    const unresolved = app.metadataCache.unresolvedLinks;

    // Reverse index of resolvedLinks (same semantics as the indexer's
    // buildIncomingSet — self-links don't count).
    const incoming = new Set<string>();
    for (const [src, targets] of Object.entries(resolved)) {
        for (const path of Object.keys(targets)) {
            if (path !== src) incoming.add(path);
        }
    }

    const memo = new Map<string, "hot" | "cold">();
    return (path: string) => {
        const hit = memo.get(path);
        if (hit !== undefined) return hit;

        const file = app.vault.getAbstractFileByPath(path);
        // Path in the index but gone from disk (deleted/renamed since):
        // report hot so a ghost row can never win a Cold promotion slot.
        if (!(file instanceof TFile)) {
            memo.set(path, "hot");
            return "hot";
        }

        const tier = deriveTier({
            created: resolveCreated(app, file),
            mtime: file.stat.mtime,
            hasOutgoing: hasEntries(resolved[path]) || hasEntries(unresolved[path]),
            hasIncoming: incoming.has(path),
            selfWriteMtime: selfWrites[path],
            now,
            hotDays,
        });
        memo.set(path, tier);
        return tier;
    };
}
