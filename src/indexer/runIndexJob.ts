/**
 * Mutual exclusion + failure reporting for the four index entry points
 * (rebuild / update commands and their Settings buttons).
 *
 * Before 031 a failing rebuild rejected into the caller, so the button that
 * awaited it never re-enabled and the user was left staring at "Indexing…"
 * with the reason only in the developer console. This helper never rejects:
 * every outcome comes back through `report`.
 */

export interface IndexJobHost {
    indexing: boolean;
}

export interface IndexJobReport {
    /** Another job already holds the lock. */
    busy: () => void;
    /** The job threw — user-facing, already truncated. */
    failed: (message: string) => void;
    /** The raw error, for the console. */
    log: (err: unknown) => void;
}

const MAX_MESSAGE_LEN = 200;

function describe(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return text.length > MAX_MESSAGE_LEN ? text.slice(0, MAX_MESSAGE_LEN) + "…" : text;
}

/** Run `job` under `host.indexing`, reporting instead of rejecting. */
export async function runIndexJob(
    host: IndexJobHost,
    job: () => Promise<void>,
    report: IndexJobReport,
): Promise<void> {
    if (host.indexing) {
        report.busy();
        return;
    }
    host.indexing = true;
    try {
        await job();
    } catch (err) {
        report.log(err);
        report.failed(describe(err));
    } finally {
        host.indexing = false;
    }
}
