// 042 D4: the embedding provider keeps the URL and key it was built with,
// so edits on the settings page take effect when the page closes or right
// before an index job, never on every keystroke. Pure logic; main.ts and
// the settings tab supply the side effects.

import type { VaultSearchSettings } from "../types";
import { keyText } from "./resolveLlmApiKey";

export interface Connection { url: string; key: string }

type ConnectionSettings = Pick<VaultSearchSettings, "embeddingProvider" | "ollamaUrl" | "apiKey">;

export function connectionOf(s: ConnectionSettings): Connection {
    return { url: keyText(s.ollamaUrl), key: keyText(s.apiKey) };
}

/** The settings name a different server or key than the running provider.
 *  The built-in model has no connection, so it is never stale. */
export function connectionStale(s: ConnectionSettings, built: Connection): boolean {
    if (s.embeddingProvider === "wasm") return false;
    const now = connectionOf(s);
    return now.url !== built.url || now.key !== built.key;
}

/** Each call runs after the previous one settles; a failure doesn't block
 *  the next call, and every caller gets its own call's outcome. */
export function serialize(run: () => Promise<void>): () => Promise<void> {
    let chain: Promise<void> = Promise.resolve();
    return () => {
        chain = chain.catch(() => { /* the earlier caller handles it */ }).then(run);
        return chain;
    };
}

export interface ConnectionHost {
    mobile: boolean;
    settings: ConnectionSettings;
    built: Connection;
    indexer?: { indexing: boolean };
    reload(): Promise<void>;
    refreshMobile(): void;
}

function desktopStale(h: ConnectionHost): boolean {
    return !h.mobile && !!h.indexer && !h.indexer.indexing && connectionStale(h.settings, h.built);
}

/** Settings page closed. A running index job keeps its provider; the next
 *  job applies the change through applyBeforeIndexJob. */
export function applyOnClose(h: ConnectionHost): void {
    if (h.mobile) {
        h.refreshMobile();
        return;
    }
    if (desktopStale(h)) {
        // reload already showed a Notice on failure.
        void h.reload().catch(() => { /* handled */ });
    }
}

/** Apply a pending edit before an index job. False means the reload failed
 *  (its Notice already shown) and the job must not start. */
export async function applyBeforeIndexJob(h: ConnectionHost): Promise<boolean> {
    if (!desktopStale(h)) return true;
    try {
        await h.reload();
        return true;
    } catch {
        return false;
    }
}
