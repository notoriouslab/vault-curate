import { App, requestUrl, TFile } from "obsidian";
import type { ApiFormat } from "./types";
import { stripReasoningWrappers } from "./utils/stripReasoningWrappers";

export interface OllamaModel {
    name: string;
    sizeGB: number;
    isEmbedding: boolean;
}

export async function fetchOllamaModels(url: string, format: ApiFormat = "ollama"): Promise<OllamaModel[]> {
    try {
        validateServerUrl(url);

        if (format === "openai") {
            const resp = await requestUrl({ url: `${url}/v1/models`, throw: false });
            if (resp.status !== 200) return [];
            const data = resp.json as { data?: Array<{ id: string }> };
            return (data.data ?? []).map((m) => ({
                name: m.id,
                sizeGB: 0,
                isEmbedding: /embed/i.test(m.id),
            }));
        }

        const resp = await requestUrl({ url: `${url}/api/tags`, throw: false });
        if (resp.status !== 200) return [];
        const data = resp.json as { models?: Array<{ name: string; size: number }> };
        return (data.models ?? []).map((m) => ({
            name: m.name,
            sizeGB: m.size / 1e9,
            isEmbedding: /embed/i.test(m.name),
        }));
    } catch {
        return [];
    }
}

export async function checkOllama(url: string): Promise<boolean> {
    try {
        validateServerUrl(url);
        const resp = await requestUrl({ url, throw: false });
        return resp.status === 200;
    } catch {
        return false;
    }
}

export interface LLMReachability {
    reachable: boolean;
    endpoint: string;
    protocol: ApiFormat;
    reason?: string;
}

/**
 * Probe the configured LLM endpoint (Ollama or OpenAI-compatible) used by
 * AI curation. Surfaces the same shape regardless of protocol so callers
 * can render a uniform status line. Used by the Settings UI to answer the
 * "I enabled AI curation but nothing happens" support pattern in-place,
 * instead of forcing users to trigger description generation just to
 * discover the endpoint is down.
 */
export async function checkLLMReachable(
    cfg: { ollamaUrl: string; apiFormat: ApiFormat; apiKey: string },
): Promise<LLMReachability> {
    const endpoint = (cfg.ollamaUrl || "").replace(/\/$/, "");
    const protocol = cfg.apiFormat;
    const result: LLMReachability = { reachable: false, endpoint, protocol };
    if (!endpoint) {
        result.reason = "no endpoint configured";
        return result;
    }
    try {
        validateServerUrl(endpoint);
    } catch (err) {
        result.reason = err instanceof Error ? err.message : String(err);
        return result;
    }
    const probeUrl = protocol === "ollama"
        ? `${endpoint}/api/tags`
        : (endpoint.endsWith("/v1") ? `${endpoint}/models` : `${endpoint}/v1/models`);
    try {
        const resp = await withTimeout(
            requestUrl({
                url: probeUrl,
                method: "GET",
                headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
                throw: false,
            }),
            3000,
            "LLM reachability probe",
        );
        if (resp.status >= 200 && resp.status < 300) {
            result.reachable = true;
        } else {
            result.reason = `HTTP ${resp.status}`;
        }
    } catch (err) {
        result.reason = err instanceof Error ? err.message : "connection error";
    }
    return result;
}

export function cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

export function stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const end = content.indexOf("---", 3);
    if (end === -1) return content;
    return content.slice(end + 3).trim();
}

function buildHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    return headers;
}

function truncateError(text: string, max = 200): string {
    return text.length > max ? text.slice(0, max) + "..." : text;
}

export function validateServerUrl(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http/https server URLs are supported");
    }
    if (isMetadataOrLinkLocal(parsed.hostname)) {
        throw new Error("Refusing to target link-local / cloud-metadata endpoint");
    }
}

// Reject hosts a user has no legitimate reason to point at: cloud metadata
// endpoints (AWS/Azure/GCP at 169.254.169.254, Azure IMDS at 168.63.129.16,
// Alibaba at 100.100.100.200) plus IPv6 link-local + deprecated site-local.
// RFC 1918 private ranges (10/8, 172.16/12, 192.168/16) are NOT rejected —
// LAN-hosted Ollama is a real use case.
function isMetadataOrLinkLocal(rawHost: string): boolean {
    const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    if (/^169\.254\./.test(host)) return true;            // IPv4 link-local /16
    if (host === "168.63.129.16") return true;            // Azure IMDS
    if (host === "100.100.100.200") return true;          // Alibaba metadata
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;    // IPv6 link-local fe80::/10
    if (/^fe[c-f][0-9a-f]?:/.test(host)) return true;     // IPv6 site-local fec0::/10 (deprecated, still routable)
    return false;
}

/**
 * Strict loopback host detection — catches the bypasses a literal allow-list
 * misses:
 *   - bare "0" resolves to 0.0.0.0 on Linux/macOS
 *   - 127.x.x.x covers the whole /8 loopback block
 *   - expanded IPv6 ("0:0:0:0:0:0:0:1") + zone-id ("::1%lo0")
 *   - bracketed IPv6 from URL.hostname
 *   - integer-encoded IPv4 (2130706433 = 127.0.0.1)
 *
 * Anything else is treated as remote so security warnings (HTTP+Bearer,
 * cleartext keys) fire correctly.
 */
export function isLoopbackHost(rawHost: string): boolean {
    if (!rawHost) return false;
    // URL.hostname strips brackets for some hosts but keeps them when a
    // zone-id is present; normalise either way.
    let host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    // Strip zone-id suffix (e.g. "::1%lo0" → "::1") — it's a routing hint,
    // not part of the host identity.
    const zoneIdx = host.indexOf("%");
    if (zoneIdx >= 0) host = host.slice(0, zoneIdx);
    // Trailing dot in FQDN form.
    if (host.endsWith(".")) host = host.slice(0, -1);

    if (host === "localhost") return true;

    // IPv4 (dotted-quad + shorthand). 127/8 is the loopback block.
    if (/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(host)) {
        const parts = host.split(".").map(p => parseInt(p, 10));
        if (parts[0] === 127) return true;
        if (parts.every(p => p === 0)) return true;
        return false;
    }
    // Bare "0" or "127" → kernel completes to 0.0.0.0 / 127.0.0.1.
    if (host === "0" || host === "127") return true;
    // Integer-encoded IPv4: 2130706433 = 127.0.0.1.
    if (/^\d+$/.test(host)) {
        const n = parseInt(host, 10);
        if (!Number.isNaN(n) && n >= 0 && n <= 0xffffffff) {
            const a = (n >>> 24) & 0xff;
            if (a === 127 || n === 0) return true;
        }
        return false;
    }

    // IPv6 — accept both compressed (`::1`) and fully-expanded forms.
    if (host.includes(":")) {
        // Strip optional `::` short form by expanding to 8 groups.
        const groups = expandIPv6(host);
        if (!groups) return false;
        const allZeroExceptLast = groups.slice(0, 7).every(g => g === 0);
        if (allZeroExceptLast && groups[7] === 1) return true;
        // IPv4-mapped IPv6 (`::ffff:7f00:0001` == 127.0.0.1). The first 5
        // groups are zero, group 5 == 0xffff, and the last two encode the
        // IPv4 address with the high byte of group 6 being the first octet.
        if (
            groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
            groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff
        ) {
            const a = (groups[6] >>> 8) & 0xff;
            const allZeroV4 = groups[6] === 0 && groups[7] === 0;
            if (a === 127 || allZeroV4) return true;
        }
        return false;
    }

    return false;
}

function expandIPv6(host: string): number[] | null {
    // Split on `::` once. Each side has its own colon-separated groups.
    const halves = host.split("::");
    if (halves.length > 2) return null;
    const parseSide = (s: string): number[] | null => {
        if (s === "") return [];
        const parts = s.split(":");
        const out: number[] = [];
        for (const p of parts) {
            if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
            out.push(parseInt(p, 16));
        }
        return out;
    };
    const head = parseSide(halves[0]);
    if (head === null) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    const tail = parseSide(halves[1]);
    if (tail === null) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    const padding: number[] = Array<number>(fill).fill(0);
    return [...head, ...padding, ...tail];
}

export async function embedText(
    text: string,
    url: string,
    model: string,
    format: ApiFormat,
    apiKey?: string,
): Promise<number[]> {
    const results = await embedTexts([text], url, model, format, apiKey);
    return results[0] ?? [];
}

const EMBED_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: number;
    // Swallow late rejection — if the timeout wins the race, a subsequent
    // rejection from `promise` would otherwise surface as an unhandled
    // rejection in the renderer console. Mirrors the same pattern in
    // OnboardingModal.withTimeout.
    void promise.catch(() => { /* late rejection swallowed by design */ });
    return Promise.race([
        promise.finally(() => window.clearTimeout(timer)),
        new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error(`${label} timeout (${ms / 1000}s)`)), ms);
        }),
    ]);
}

export async function embedTexts(
    texts: string[],
    url: string,
    model: string,
    format: ApiFormat,
    apiKey?: string,
): Promise<number[][]> {
    if (texts.length === 0) return [];
    validateServerUrl(url);

    if (format === "openai") {
        const resp = await withTimeout(requestUrl({
            url: `${url}/v1/embeddings`,
            method: "POST",
            headers: buildHeaders(apiKey),
            body: JSON.stringify({ model, input: texts }),
            throw: false,
        }), EMBED_TIMEOUT_MS, "Embedding");
        if (resp.status !== 200) throw new Error(`API ${resp.status}: ${truncateError(resp.text)}`);
        const data = resp.json as { data?: Array<{ index: number; embedding: number[] }> };
        // OpenAI returns {data: [{embedding: [...]}, ...]} sorted by index
        return (data.data ?? [])
            .sort((a, b) => a.index - b.index)
            .map((d) => d.embedding ?? []);
    }

    // Ollama format — supports input as string[]
    const resp = await withTimeout(requestUrl({
        url: `${url}/api/embed`,
        method: "POST",
        headers: buildHeaders(apiKey),
        body: JSON.stringify({ model, input: texts }),
        throw: false,
    }), EMBED_TIMEOUT_MS, "Embedding");
    if (resp.status !== 200) throw new Error(`Ollama ${resp.status}: ${truncateError(resp.text)}`);
    const data = resp.json as { embeddings?: number[][] };
    return data.embeddings ?? [];
}

const LLM_TIMEOUT_MS = 60000;

/**
 * Unified LLM JSON request with Ollama and OpenAI-compatible support.
 * The caller supplies a `parse` function that converts the raw content
 * string to T — it may throw on invalid payloads.
 */
export async function requestLlmJson<T>(
    settings: {
        ollamaUrl: string;
        llmModel: string;
        apiFormat: ApiFormat;
        apiKey?: string;
    },
    prompt: string,
    parse: (raw: string) => T,
    opts: { timeoutMs?: number } = {},
): Promise<T> {
    validateServerUrl(settings.ollamaUrl);
    const isOpenAI = settings.apiFormat === "openai";
    const endpoint = isOpenAI
        ? `${settings.ollamaUrl}/v1/chat/completions`
        : `${settings.ollamaUrl}/api/chat`;

    const body = isOpenAI
        ? JSON.stringify({
            model: settings.llmModel,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
        })
        : JSON.stringify({
            model: settings.llmModel,
            messages: [{ role: "user", content: prompt }],
            stream: false,
            format: "json",
            think: false,
        });

    const resp = await withTimeout(
        requestUrl({
            url: endpoint,
            method: "POST",
            headers: buildHeaders(settings.apiKey),
            body,
            throw: false,
        }),
        opts.timeoutMs ?? LLM_TIMEOUT_MS,
        "LLM",
    );

    if (resp.status !== 200) {
        throw new Error(`LLM ${resp.status}: ${truncateError(resp.text)}`);
    }

    const data = resp.json as {
        choices?: Array<{ message?: { content?: string } }>;
        message?: { content?: string };
    };
    const raw = isOpenAI
        ? (data.choices?.[0]?.message?.content ?? "")
        : (data.message?.content ?? "");
    return parse(stripReasoningWrappers(raw));
}

/**
 * Build an Obsidian wikilink from a note path + display title.
 * Strips `.md` extension, escapes `|` in title to `｜` (fullwidth)
 * so the display alias does not terminate early. Title `[`/`]` are
 * left as-is to preserve v0.3.x byte-for-byte output.
 */
export function toWikilink(path: string, title: string): string {
    const target = path.replace(/\.md$/, "");
    const safeTitle = title.replace(/\|/g, "\uff5c");
    return `[[${target}|${safeTitle}]]`;
}

/**
 * @deprecated Phase 4 (004 rebrand) — superseded by `src/indexer/chunker.ts`.
 * Kept only because searcher.ts / search-view.ts still depend on the v0.3.x
 * `embedText` helper; remove together when Phase 5 rewires those callers to
 * the EmbeddingProvider abstraction.
 */
export function splitChunks(text: string, size: number, overlap: number): string[] {
    if (text.length <= size) return [text];
    if (overlap >= size) overlap = 0;
    const step = size - overlap;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += step) {
        chunks.push(text.slice(i, i + size));
        if (i + size >= text.length) break;
    }
    return chunks;
}

export function computeTitleBoost(query: string, title: string): number {
    const q = query.toLowerCase().trim();
    const t = title.toLowerCase().trim();
    if (!q || !t) return 0;

    // Exact match
    if (q === t) return 0.25;

    // One contains the other (partial title match)
    if (t.includes(q) || q.includes(t)) return 0.15;

    // Word overlap — handles both CJK (single-word titles) and multi-word Latin titles
    const qWords = q.split(/\s+/).filter(Boolean);
    const tWords = t.split(/\s+/).filter(Boolean);
    if (qWords.length > 0 && tWords.length > 0) {
        const matched = qWords.filter(w =>
            tWords.some(tw => tw.includes(w) || w.includes(tw))
        ).length;
        if (matched > 0) return 0.08 * (matched / qWords.length);
    }

    return 0;
}

export function renderResultItem(
    container: HTMLElement,
    result: import("./types").SearchResult,
    app: import("obsidian").App,
) {
    if (result.tier === "cold") container.addClass("is-cold");

    const titleRow = container.createDiv({ cls: "vault-curate-title-row" });
    titleRow.createSpan({
        text: result.tier === "cold" ? "\u2744\ufe0f" : "\ud83d\udd25",
        cls: `vault-curate-tier vault-curate-tier-${result.tier}`,
    });
    titleRow.createSpan({ text: result.title, cls: "vault-curate-title" });
    titleRow.createSpan({ text: result.score.toFixed(3), cls: "vault-curate-score" });

    const file = app.vault.getAbstractFileByPath(result.path);
    if (file instanceof TFile) {
        void getContentPreview(app, file).then(preview => {
            if (preview && container.isConnected) {
                container.createDiv({ text: preview, cls: "vault-curate-desc" });
            }
        });
    }

    const metaRow = container.createDiv({ cls: "vault-curate-meta" });
    if (result.tags.length > 0) {
        metaRow.createSpan({ text: result.tags.join(", "), cls: "vault-curate-tags" });
    }
    const folder = result.path.substring(0, result.path.lastIndexOf("/"));
    if (folder) {
        metaRow.createSpan({ text: folder, cls: "vault-curate-folder" });
    }
}

/** Format a Date as `YYYY-MM-DD HH:MM+TZ:TZ` with the local timezone offset. */
export function formatLocalDateTime(d: Date): string {
    const tzOffset = -d.getTimezoneOffset();
    const sign = tzOffset >= 0 ? "+" : "-";
    const tzH = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
    const tzM = String(Math.abs(tzOffset) % 60).padStart(2, "0");
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${date} ${time}${sign}${tzH}:${tzM}`;
}

export async function getContentPreview(app: App, file: TFile, maxChars = 100): Promise<string> {
    const cache = app.metadataCache.getFileCache(file);
    const desc = cache?.frontmatter?.description as unknown;
    if (typeof desc === "string" && desc.length > 0) return desc;

    const raw = await app.vault.cachedRead(file);
    let body = stripFrontmatter(raw);
    body = body.replace(/^#+\s+.*\n?/, "").trim();
    if (body.length > maxChars) body = body.slice(0, maxChars) + "…";
    return body;
}
