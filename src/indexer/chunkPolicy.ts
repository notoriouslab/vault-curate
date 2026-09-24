/**
 * chunkPolicy — decisions for the one-time chunking upgrade (034 D2).
 *
 * The index stamps `chunk_policy` with how its chunks were cut. When the
 * provider's policy differs (the built-in model moved to token-budgeted
 * chunks), notes must be re-embedded. That upgrade runs in the background,
 * can be interrupted, and can fail part-way, so it is tracked by a
 * `chunk_upgrade_target` meta value of the form "<policy>@<startedAtMs>#<attempt>":
 * notes indexed at or after `startedAt` are already done, and `attempt`
 * counts the passes that ended with failures.
 *
 * Everything here is pure so the upgrade rules can be unit-tested without an
 * indexer.
 */

export type ChunkUpgradeState = "none" | "stamp-only" | "reembed";

export interface ChunkTarget {
    policy: string;
    startedAt: number;
    /** Number of passes that already ended with failures. */
    attempt: number;
}

/** A pass that still has failures on this attempt gives up and stamps anyway. */
export const MAX_UPGRADE_ATTEMPTS = 3;

interface PolicyProvider { chunkPolicy?: string }
interface CharSettings { chunkSize: number; chunkOverlap: number }

/** The policy the index should be stamped with for this provider. */
export function effectiveChunkPolicy(p: PolicyProvider, s: CharSettings): string {
    return p.chunkPolicy ?? `char${s.chunkSize}-o${s.chunkOverlap}`;
}

/**
 * What the stored stamp means for this provider. An external provider on an
 * index that predates the stamp cut its chunks exactly as it still does, so
 * it only needs the stamp written, not a re-embed.
 */
export function chunkUpgradeState(stored: string | null, p: PolicyProvider, s: CharSettings): ChunkUpgradeState {
    const effective = effectiveChunkPolicy(p, s);
    if (stored === effective) return "none";
    if (stored === null && p.chunkPolicy === undefined) return "stamp-only";
    return "reembed";
}

const TARGET_RE = /^(.+)@(\d+)(?:#(\d+))?$/;

/** Parse "<policy>@<ms>#<attempt>"; a missing attempt is 0. Malformed → null. */
export function parseChunkTarget(s: string | null): ChunkTarget | null {
    if (!s) return null;
    const m = TARGET_RE.exec(s);
    if (!m) return null;
    return { policy: m[1], startedAt: Number(m[2]), attempt: m[3] === undefined ? 0 : Number(m[3]) };
}

export function formatChunkTarget(t: ChunkTarget): string {
    return `${t.policy}@${t.startedAt}#${t.attempt}`;
}

/**
 * Resume the stored target if it is for this policy; otherwise start a new
 * one at `now`. `rewrite` tells the caller to persist `target`.
 */
export function planChunkUpgrade(
    storedTarget: string | null,
    effective: string,
    now: number,
): { target: string; startedAt: number; attempt: number; rewrite: boolean } {
    const t = parseChunkTarget(storedTarget);
    if (!t || t.policy !== effective) {
        const fresh = { policy: effective, startedAt: now, attempt: 0 };
        return { target: formatChunkTarget(fresh), startedAt: now, attempt: 0, rewrite: true };
    }
    return { target: formatChunkTarget(t), startedAt: t.startedAt, attempt: t.attempt, rewrite: false };
}

/**
 * What to persist when a pass ends.
 *   - Clean pass: stamp if the policy changed, drop any target.
 *   - Failures while an upgrade is pending: never stamp — that would mark
 *     the failed notes as upgraded forever. Record or bump the target so the
 *     next pass retries only them, and give up (stamp anyway) on the
 *     MAX_UPGRADE_ATTEMPTS-th failing pass so a note that always fails
 *     cannot make every launch retry.
 *   - Failures with no upgrade pending: nothing to do here.
 */
export function finalizeChunkUpgrade(i: {
    failed: number;
    storedPolicy: string | null;
    effective: string;
    target: ChunkTarget | null;
    runStartMs: number;
}): { stampPolicy: boolean; deleteTarget: boolean; writeTarget: string | null; giveUp: boolean } {
    if (i.failed === 0) {
        return {
            stampPolicy: i.storedPolicy !== i.effective,
            deleteTarget: i.target !== null,
            writeTarget: null,
            giveUp: false,
        };
    }
    const nothing = { stampPolicy: false, deleteTarget: false, writeTarget: null, giveUp: false };
    if (i.storedPolicy === i.effective) return nothing;

    // A target left over from another policy says nothing about this one.
    const t = i.target && i.target.policy === i.effective ? i.target : null;
    if (!t) {
        return { ...nothing, writeTarget: formatChunkTarget({ policy: i.effective, startedAt: i.runStartMs, attempt: 1 }) };
    }
    if (t.attempt + 1 < MAX_UPGRADE_ATTEMPTS) {
        return { ...nothing, writeTarget: formatChunkTarget({ ...t, attempt: t.attempt + 1 }) };
    }
    return { stampPolicy: true, deleteTarget: true, writeTarget: null, giveUp: true };
}
