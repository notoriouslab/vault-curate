/** 013 D10: promise-serialized write queue — at most one job in flight,
 *  later calls line up behind it in call order.
 *
 *  Why: saveSettings snapshots the whole settings object per call. Two
 *  overlapping fire-and-forget saves (e.g. a dismiss immediately followed
 *  by a rename's maintenance save) race on disk-I/O completion order; if
 *  the older snapshot lands last it silently overwrites the newer one.
 *  Serializing makes completion order equal call order, so the last
 *  writer always holds the freshest state.
 *
 *  The returned promise settles with its own job (rejections propagate to
 *  the caller), but a rejected job never poisons the chain — the next job
 *  still runs. */
export function createWriteQueue(): (job: () => Promise<void>) => Promise<void> {
    let tail: Promise<void> = Promise.resolve();
    return (job) => {
        const run = tail.then(job, job);
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
}
