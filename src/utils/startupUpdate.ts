import type { ChunkUpgradeState } from "../indexer/chunkPolicy";

/**
 * Whether launch should kick an incremental update (007 D2, 034 D2).
 * Desktop only (update is a full-embed write path) and only for an existing
 * index. A "stamp-only" chunk state is excluded on purpose: the caller writes
 * the stamp directly, because update() also prunes excluded folders (G14)
 * and that is not worth paying just to record a policy string.
 */
export function needsStartupUpdate(s: {
    indexed: boolean;
    isMobile: boolean;
    denoiseStale: boolean;
    t2sStale: boolean;
    descPending: boolean;
    chunkState: ChunkUpgradeState;
}): boolean {
    if (!s.indexed || s.isMobile) return false;
    return s.denoiseStale || s.t2sStale || s.descPending || s.chunkState === "reembed";
}
