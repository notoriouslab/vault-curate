/**
 * WASM asset loader (cache-then-fetch).
 *
 * Why this exists:
 *   Obsidian's `app://obsidian.md` origin has no CORS permission against
 *   github.com release downloads, so browser-level `fetch()` (in main thread
 *   OR a dedicated worker) for `sql-wasm.wasm` / `ort-wasm-simd-threaded.wasm`
 *   gets blocked with `No 'Access-Control-Allow-Origin' header`. Obsidian's
 *   `requestUrl` goes through Electron's main process and is not subject to
 *   browser CORS — so we use it to fetch the binaries once, cache them in the
 *   plugin folder, and hand the raw bytes to sql.js (via `wasmBinary`) and
 *   onnxruntime-web (via `env.wasm.wasmBinary`). Neither runtime needs a URL
 *   when given the bytes directly.
 *
 * Cache lives in the plugin folder so it survives plugin updates and is
 * obvious for users who need to delete and re-fetch on a corrupt download.
 */
import { type Plugin, normalizePath, requestUrl } from "obsidian";

export async function loadWasmAsset(
    plugin: Plugin,
    filename: string,
    releaseUrl: string,
    opts?: {
        /** 015: mobile passes false — a cache miss fetches into memory and
         *  uses the bytes directly, never writing into the (synced, otherwise
         *  read-only) plugin folder. Desktop keeps the write-back cache. */
        persistCache?: boolean;
    },
): Promise<Uint8Array> {
    const persistCache = opts?.persistCache ?? true;
    const dir = plugin.manifest.dir;
    if (dir) {
        const cachePath = normalizePath(`${dir}/${filename}`);
        const adapter = plugin.app.vault.adapter;
        if (await adapter.exists(cachePath)) {
            try {
                const buf = await adapter.readBinary(cachePath);
                return new Uint8Array(buf);
            } catch (err) {
                console.warn(
                    `vault-curate: failed to read cached ${filename}, re-fetching from GitHub`,
                    err,
                );
            }
        }
        const bytes = await fetchViaRequestUrl(releaseUrl, filename);
        if (persistCache) {
            try {
                const ab = new ArrayBuffer(bytes.byteLength);
                new Uint8Array(ab).set(bytes);
                await adapter.writeBinary(cachePath, ab);
            } catch (err) {
                console.warn(
                    `vault-curate: failed to cache ${filename} to plugin folder`,
                    err,
                );
            }
        }
        return bytes;
    }
    return await fetchViaRequestUrl(releaseUrl, filename);
}

async function fetchViaRequestUrl(
    url: string,
    filename: string,
): Promise<Uint8Array> {
    const resp = await requestUrl({ url, method: "GET", throw: false });
    if (resp.status < 200 || resp.status >= 300) {
        throw new Error(
            `Failed to download ${filename} (HTTP ${resp.status}) from ${url}. ` +
                `vault-curate needs to fetch WASM runtime assets from GitHub on first run — ` +
                `check your internet connection and retry by reloading the plugin.`,
        );
    }
    return new Uint8Array(resp.arrayBuffer);
}
