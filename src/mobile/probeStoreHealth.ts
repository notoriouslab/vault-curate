/**
 * 015 review (re-review W): the guilt probe behind mobile's
 * teardown-on-error. A torn iCloud file can leave the tiny `meta` table's
 * early pages intact while the much larger `notes`/`chunks` B-trees are
 * broken — so ruling a store "healthy" must touch all three, or partial
 * corruption defeats the auto-recovery convergence entirely.
 */
type ProbeableStore = {
    getMeta(key: string): string | null;
    countChunks(): number;
    getAllTitles(): Map<string, string>;
};

/** True when basic reads across meta + chunks + notes all succeed. */
export function probeStoreHealth(store: ProbeableStore): boolean {
    try {
        store.getMeta("schema_version");
        store.countChunks();
        store.getAllTitles();
        return true;
    } catch {
        return false;
    }
}
