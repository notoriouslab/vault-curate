// Query-time tier derivation (010 D5) — pure function, no Obsidian imports.
//
// Tier is derived data (timestamps + link presence). Deriving at query time
// instead of trusting the index-time SQLite snapshot is the only shape that
// is correct on every transition path: crossing the hotDays boundary fires
// no file event, so a stored tier is inherently stale. The stored
// `notes.tier` column stays written as an advisory fallback.
//
// Heat criterion (主公 2026-07-23, "判定動作"): any user edit — even a
// character typed and deleted — is a deliberate judgment about the note and
// re-heats it. Merely OPENING a note is exposure, not judgment, and is
// deliberately excluded (Discover would otherwise whitewash every Cold note
// it surfaces).

/** |mtime − selfWriteMtime| within this window ⇒ the modification was the
 *  plugin's own batch write (description generator), not a user judgment.
 *  Covers fs timestamp granularity + stat cache latency only — the ledger
 *  records mtime AFTER the write resolves, so write duration is excluded. */
export const SELF_WRITE_TOLERANCE_MS = 2000;

export interface TierInput {
    /** Creation timestamp (ms): frontmatter `created` when present, else
     *  file ctime — resolution happens at the caller (needs metadataCache). */
    created: number;
    /** File mtime (ms). */
    mtime: number;
    hasOutgoing: boolean;
    hasIncoming: boolean;
    /** Ledger entry for this path, if any (ms). */
    selfWriteMtime?: number;
    now: number;
    hotDays: number;
}

export function deriveTier(input: TierInput): "hot" | "cold" {
    if (input.hasOutgoing || input.hasIncoming) return "hot";

    const exempt = input.selfWriteMtime !== undefined
        && Math.abs(input.mtime - input.selfWriteMtime) <= SELF_WRITE_TOLERANCE_MS;
    const effectiveMtime = exempt ? 0 : input.mtime;

    const hotMs = input.hotDays * 24 * 60 * 60 * 1000;
    const isRecent = input.now - Math.max(input.created, effectiveMtime) < hotMs;
    return isRecent ? "hot" : "cold";
}

export type TierResolver = (path: string) => "hot" | "cold";
