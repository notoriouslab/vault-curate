/**
 * 015 D4: mobile index size guard. Loading the index means holding the whole
 * file in memory (sql.js keeps the DB as a file image), so an oversized index
 * would OOM-crash the mobile app — refusing with a message beats a silent
 * crash (Omnisearch's iOS hard-crash lesson).
 *
 * 300MB ≈ a ~10k-note vault at the measured ~28KB/note (69.6MB / 2,518 notes,
 * 2026-08-06). Revisit after 016 shrinks the on-disk format.
 */
export const MOBILE_INDEX_MAX_BYTES = 300 * 1024 * 1024;

export type IndexLoadDecision = 'load' | 'too-large';

/** Pure decision: unknown sizes (null / 0 / negative) load optimistically —
 *  iCloud placeholder stats can misreport, and open() has its own try/catch. */
export function indexLoadDecision(sizeBytes: number | null): IndexLoadDecision {
    if (sizeBytes === null || sizeBytes <= 0) return 'load';
    return sizeBytes > MOBILE_INDEX_MAX_BYTES ? 'too-large' : 'load';
}
