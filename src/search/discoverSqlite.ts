// Discover (SQLite-backed) — Phase 8 of 004 rebrand.
//
// 007: ranking vectors are composed + unit-norm at the store read boundary
// (`noteVec` = desc-weighted blend, see SQLiteStore.getAllNotesLight /
// getNoteVec), so dot product IS cosine similarity. All public functions go
// through `getAllNotesLight()` — a single SELECT per call — instead of
// N times `getNote()` inside the candidate loop.
//
// `dimGuard()` defends against provider-switch mid-state where the query
// vector and stored vectors have different dimensions. We warn once per
// call (not per-vector) so the console doesn't get spammed and silently
// skip the bad rows.

import type { SQLiteStore } from "../storage/SQLiteStore";
import type { SearchResult } from "../types";
import type { TierResolver } from "../heat/deriveTier";
import { folderOf } from "../utils/folderOf";
import { fuseRanks, FUSION_POOL } from "./relatedFusion";
import { groupedGlobalRank, type ColdRow, type GroupedResults } from "./globalProfile";

function cosineNormalized(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

export interface DiscoverSettings {
    minScore: number;
    topResults: number;
    /** 008 D7 (findSimilarSqlite only): cap results sharing the query
     *  note's folder — template siblings live together and crowd out the
     *  note's actual content. 0/undefined disables. */
    sameFolderCap?: number;
    /** 010 D5: query-time tier derivation. When absent, the stored
     *  (advisory) tier is used — keeps this module Obsidian-free and the
     *  existing tests untouched. */
    tierResolver?: TierResolver;
    /** 011: note-level keyword ranks from the anchor's pseudo-query (see
     *  relatedKwRank). When present, the minScore-filtered cosine order is
     *  RRF-fused with it before any downstream step; absent/empty = pure
     *  cosine order. */
    kwRank?: Map<string, number>;
}

/** RRF re-rank of the top FUSION_POOL entries of a score-descending
 *  result list (011 D3/D4). Entries beyond the pool keep their cosine
 *  order after the pool. */
function applyFusion(
    sorted: SearchResult[],
    kwRank: Map<string, number> | undefined,
): SearchResult[] {
    if (!kwRank || kwRank.size === 0 || sorted.length === 0) return sorted;
    const pool = sorted.slice(0, FUSION_POOL);
    const rest = sorted.slice(FUSION_POOL);
    const byPath = new Map(pool.map((r) => [r.path, r]));
    const fused = fuseRanks(pool.map((r) => r.path), kwRank);
    return [...fused.map((p) => byPath.get(p) as SearchResult), ...rest];
}

const YIELD_EVERY = 50;

/**
 * Notes most similar to `currentPath`, ranked purely by (fused)
 * relatedness — cold notes carry a visual mark instead of jumping the
 * queue. Yields to the main thread every 50 candidates so a 10k-note
 * vault doesn't freeze the sidebar.
 */
export async function discoverForNoteSqlite(
    currentPath: string,
    store: SQLiteStore,
    settings: DiscoverSettings,
    cancelled?: { value: boolean },
): Promise<SearchResult[]> {
    const queryVec = store.getNoteVec(currentPath);
    if (!queryVec || queryVec.length === 0) return [];

    const all = store.getAllNotesLight();
    const queryDim = queryVec.length;
    const results: SearchResult[] = [];
    let dimMismatchCount = 0;

    for (let i = 0; i < all.length; i++) {
        if (cancelled?.value) break;
        const row = all[i];
        if (row.path === currentPath) continue;
        if (row.noteVec.length !== queryDim) {
            dimMismatchCount++;
            continue;
        }
        const score = cosineNormalized(queryVec, row.noteVec);
        // isFinite guard: a NaN score passes `score < minScore` (false) and
        // then poisons every downstream sort (011 regression review C1 —
        // same family as the 007 composeNoteVec guard).
        if (!Number.isFinite(score) || score < settings.minScore) continue;
        results.push({
            path: row.path,
            title: row.title,
            tags: [],
            score,
            tier: settings.tierResolver?.(row.path) ?? row.tier ?? "hot",
        });
        if ((i + 1) % YIELD_EVERY === 0) await new Promise(r => window.setTimeout(r, 0));
    }

    if (dimMismatchCount > 0) {
        console.warn(`vault-curate: discoverForNote skipped ${dimMismatchCount} notes with mismatched embedding dim (query=${queryDim}). Provider switched? Re-index to recover.`);
    }

    // Current-note Discover ranks purely by (fused) relatedness — cold
    // notes keep their ❄️ mark but no longer jump the queue (主公裁決
    // 2026-07-23: the block-promotion drowned relevant Hot notes once 010
    // made tiers honest; dedicated cold mining lives in Global Discover).
    results.sort((a, b) => b.score - a.score);
    const ordered = applyFusion(results, settings.kwRank);
    return ordered.slice(0, settings.topResults);
}

/**
 * Global Discover, grouped (012): Cold notes ranked against the user's
 * thinking-profile centroid, fused per top-level folder group with the
 * profile's keyword ranks (see globalProfile.ts for the rationale). This
 * replaced the Hot-pool max-pool ranking — register dominance at vault
 * scale — and dropped its O(cold·hot·dim) inner loop with it. Even on
 * cancel, the partial rows are ranked so callers never see garbage.
 */
export async function globalDiscoverGroupedSqlite(
    store: SQLiteStore,
    settings: {
        minScore: number;
        centroid: Float32Array;
        kwRank: Map<string, number>;
        tierResolver?: TierResolver;
    },
    onProgress?: (done: number, total: number) => void,
    cancelled?: { value: boolean },
): Promise<GroupedResults[]> {
    const all = store.getAllNotesLight();
    const coldRows: ColdRow[] = [];
    let dimMismatchCount = 0;

    for (let i = 0; i < all.length; i++) {
        if (cancelled?.value) break;
        const row = all[i];
        if (row.noteVec.length === 0) continue;
        if (row.noteVec.length !== settings.centroid.length) {
            // Provider-switch mid-state: silent skipping here would end in
            // an empty view whose "lower minScore" hint is WRONG advice
            // (red-team F5) — count and name the real cause below.
            dimMismatchCount++;
            continue;
        }
        const tier = settings.tierResolver?.(row.path) ?? row.tier;
        if (tier === "cold") {
            coldRows.push({ path: row.path, title: row.title, tier: "cold", vec: row.noteVec });
        }
        if ((i + 1) % YIELD_EVERY === 0) {
            onProgress?.(i + 1, all.length);
            await new Promise(r => window.setTimeout(r, 0));
        }
    }
    if (!cancelled?.value) onProgress?.(all.length, all.length);
    if (dimMismatchCount > 0) {
        console.warn(`vault-curate: globalDiscover skipped ${dimMismatchCount} notes with mismatched embedding dim. Provider switched? Re-index to recover.`);
    }

    return groupedGlobalRank(coldRows, settings.centroid, settings.kwRank, {
        minScore: settings.minScore,
    });
}

/** Find Similar — note-level cosine, no cold/hot promotion. */
export function findSimilarSqlite(
    currentPath: string,
    store: SQLiteStore,
    settings: DiscoverSettings,
): SearchResult[] {
    const queryVec = store.getNoteVec(currentPath);
    if (!queryVec || queryVec.length === 0) return [];

    const queryDim = queryVec.length;
    const all = store.getAllNotesLight();
    const results: SearchResult[] = [];
    let dimMismatchCount = 0;

    for (const row of all) {
        if (row.path === currentPath) continue;
        if (row.noteVec.length !== queryDim) {
            dimMismatchCount++;
            continue;
        }
        const score = cosineNormalized(queryVec, row.noteVec);
        if (!Number.isFinite(score) || score < settings.minScore) continue;
        results.push({
            path: row.path,
            title: row.title,
            tags: [],
            score,
            tier: settings.tierResolver?.(row.path) ?? row.tier ?? "hot",
        });
    }

    if (dimMismatchCount > 0) {
        console.warn(`vault-curate: findSimilar skipped ${dimMismatchCount} notes with mismatched embedding dim.`);
    }

    results.sort((a, b) => b.score - a.score);
    // 011: fuse before the folder cap — the cap prunes whatever order it
    // is handed, so template siblings still can't crowd the output (D4).
    const fused = applyFusion(results, settings.kwRank);

    // 008 D7: cap same-folder results. Scores are untouched — capped
    // entries are simply skipped and the next-ranked notes move up.
    const cap = settings.sameFolderCap ?? 0;
    if (cap > 0) {
        const qFolder = folderOf(currentPath);
        const out: SearchResult[] = [];
        let sameFolder = 0;
        for (const r of fused) {
            if (folderOf(r.path) === qFolder) {
                if (sameFolder >= cap) continue;
                sameFolder++;
            }
            out.push(r);
            if (out.length === settings.topResults) break;
        }
        return out;
    }
    return fused.slice(0, settings.topResults);
}

