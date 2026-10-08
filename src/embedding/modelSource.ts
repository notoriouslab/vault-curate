/**
 * Built-in model download source (039). Pure helpers: which host the WASM
 * worker downloads the model from, and how to word a failed download.
 */
import { validateServerUrl } from '../utils/hostGuards';

export type ModelDownloadSource = 'huggingface' | 'custom';

/** transformers.js downloads from here unless env.remoteHost is set. */
const DEFAULT_HOST = 'https://huggingface.co/';

/** Host to hand the worker as `remoteUrl`, or undefined to keep the
 *  transformers default. A custom URL that is empty or fails the host guard
 *  falls back to Hugging Face (the settings row shows a warning). */
export function resolveModelHost(source: string, customUrl: string): string | undefined {
    if (source !== 'custom') return undefined;
    const url = customUrl.trim();
    if (url === '') return undefined;
    try {
        validateServerUrl(url);
    } catch {
        return undefined;
    }
    return url;
}

/** Host name shown in the failure notice. */
export function modelHostLabel(host: string | undefined): string {
    try {
        return new URL(host ?? DEFAULT_HOST).hostname;
    } catch {
        return host ?? DEFAULT_HOST;
    }
}

// Fetch TypeError wording in Chromium, Firefox and WebKit. A CORS rejection
// reads the same as a dropped connection.
const UNREACHABLE_RE = /Failed to fetch|NetworkError|Load failed/i;

/** "unreachable": the request never got a response. "http": the host answered
 *  with an error; transformers puts the full download URL in those messages,
 *  so match the host URL itself (a bare hostname like "a" would match
 *  unrelated text). null: not a download failure, e.g. an ORT init error. */
export function classifyInitError(message: string, host: string | undefined): 'unreachable' | 'http' | null {
    if (UNREACHABLE_RE.test(message)) return 'unreachable';
    if (message.includes((host ?? DEFAULT_HOST).replace(/\/+$/, ''))) return 'http';
    return null;
}
