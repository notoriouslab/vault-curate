/**
 * Error replies from the embedding worker, routed by the failing request's
 * type (034 D1). Only a genuine init failure may answer with `init-error`:
 * the main thread treats that as fatal and disposes the provider, so a
 * per-request failure (one bad embed or split) must go back to its own
 * pending slot instead.
 */
export type WorkerReply =
    | { type: 'result'; id: number | undefined; vectors: null; error: string }
    | { type: 'split-result'; id: number | undefined; chunks: null; error: string }
    | { type: 'init-error'; message: string; stack?: string };

export function errorReply(msg: { type: string; id?: number }, message: string, stack?: string): WorkerReply {
    if (msg.type === 'embed') return { type: 'result', id: msg.id, vectors: null, error: message };
    if (msg.type === 'split') return { type: 'split-result', id: msg.id, chunks: null, error: message };
    return { type: 'init-error', message, stack };
}
