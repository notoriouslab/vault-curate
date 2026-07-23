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
}

const YIELD_EVERY = 50;

/**
 * Notes most similar to `currentPath`, with cold notes promoted (the
 * Discover differentiator). Yields to the main thread every 50 candidates
 * so a 10k-note vault doesn't freeze the sidebar.
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
        if (score < settings.minScore) continue;
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

    return rankWithColdPromotion(results, settings.topResults);
}

/**
 * Cold notes globally ranked by max-pool similarity to the Hot pool.
 * Even on cancel, we sort + truncate the partial result so callers
 * never see an unranked / over-budget list.
 */
export async function globalDiscoverSqlite(
    store: SQLiteStore,
    settings: DiscoverSettings,
    onProgress?: (done: number, total: number) => void,
    cancelled?: { value: boolean },
): Promise<SearchResult[]> {
    const all = store.getAllNotesLight();
    const hot: Float32Array[] = [];
    const cold: { path: string; title: string; vec: Float32Array }[] = [];
    let queryDim = 0;

    for (const row of all) {
        if (row.noteVec.length === 0) continue;
        if (queryDim === 0) queryDim = row.noteVec.length;
        const tier = settings.tierResolver?.(row.path) ?? row.tier;
        if (tier === "cold") cold.push({ path: row.path, title: row.title, vec: row.noteVec });
        else hot.push(row.noteVec);
    }
    if (hot.length === 0 || cold.length === 0) return [];

    const results: SearchResult[] = [];
    let dimMismatchCount = 0;

    for (let i = 0; i < cold.length; i++) {
        if (cancelled?.value) break;
        const item = cold[i];
        if (item.vec.length !== queryDim) {
            dimMismatchCount++;
            continue;
        }
        let max = 0;
        for (const h of hot) {
            if (h.length !== queryDim) continue;
            const s = cosineNormalized(item.vec, h);
            if (s > max) max = s;
        }
        if (max >= settings.minScore) {
            results.push({
                path: item.path,
                title: item.title,
                tags: [],
                score: max,
                tier: "cold",
            });
        }
        if ((i + 1) % YIELD_EVERY === 0) {
            onProgress?.(i + 1, cold.length);
            await new Promise(r => window.setTimeout(r, 0));
        }
    }
    // Skip the final "complete" progress callback on cancel — otherwise the
    // caller flashes "Done" before reacting to its own cancel state.
    if (!cancelled?.value) onProgress?.(cold.length, cold.length);

    if (dimMismatchCount > 0) {
        console.warn(`vault-curate: globalDiscover skipped ${dimMismatchCount} notes with mismatched embedding dim. Provider switched? Re-index to recover.`);
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, settings.topResults);
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
        if (score < settings.minScore) continue;
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

    // 008 D7: cap same-folder results. Scores are untouched — capped
    // entries are simply skipped and the next-ranked notes move up.
    const cap = settings.sameFolderCap ?? 0;
    if (cap > 0) {
        const qFolder = folderOf(currentPath);
        const out: SearchResult[] = [];
        let sameFolder = 0;
        for (const r of results) {
            if (folderOf(r.path) === qFolder) {
                if (sameFolder >= cap) continue;
                sameFolder++;
            }
            out.push(r);
            if (out.length === settings.topResults) break;
        }
        return out;
    }
    return results.slice(0, settings.topResults);
}

const MAX_COLD_PROMOTION_POOL = 200;

function rankWithColdPromotion(results: SearchResult[], topResults: number): SearchResult[] {
    results.sort((a, b) => b.score - a.score);
    const candidates = results.slice(0, Math.min(MAX_COLD_PROMOTION_POOL, topResults * 2));
    candidates.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === "cold" ? -1 : 1;
        return b.score - a.score;
    });
    return candidates.slice(0, topResults);
}
