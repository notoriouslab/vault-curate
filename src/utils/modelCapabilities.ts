/**
 * Model kind classification for the embedding / LLM model pickers.
 *
 * Three layers, in priority order:
 *  1. `/api/tags` — since Ollama 0.30.0 every entry carries a `capabilities`
 *     array. It is serialized with `omitempty`, so older servers (and the odd
 *     entry whose manifest predates the field) simply omit it.
 *  2. `/api/show` — same `capabilities` array, one request per model, used
 *     only to fill the gaps left by layer 1.
 *  3. Name heuristic — last resort for servers that report no capabilities at
 *     all, and for OpenAI-compatible endpoints whose `/v1/models` has no type
 *     information.
 *
 * A model is an embedding model when its capability list contains
 * "embedding"; the list may hold several entries (e.g. qwen3-embedding
 * reports ["tools","thinking","embedding"]), so membership is tested, never
 * equality.
 */

export type ModelKind = "embedding" | "other";
export type ModelKindSource = "capabilities" | "heuristic";

/**
 * Ollama `capabilities` array → kind. `undefined`/`null` means the server did
 * not report the field (pre-0.30.0, or omitempty on an empty list), which is
 * distinct from "reported, but not an embedding model".
 */
export function classifyByCapabilities(
    caps: readonly string[] | undefined | null,
): ModelKind | "unknown" {
    if (caps === undefined || caps === null) return "unknown";
    return caps.includes("embedding") ? "embedding" : "other";
}

/** Name fragments shared by the embedding models people actually run. */
export const EMBEDDING_NAME_HINT = /embed|bge|minilm|nomic|mxbai|jina|arctic|gte-|e5-/i;

/** Name heuristic — the third and last layer. */
export function classifyByHeuristic(name: string): ModelKind {
    return EMBEDDING_NAME_HINT.test(name) ? "embedding" : "other";
}

/** Capabilities when the server reported them, else the name heuristic. */
export function resolveModelKind(
    name: string,
    caps: readonly string[] | undefined | null,
): { kind: ModelKind; source: ModelKindSource } {
    const byCaps = classifyByCapabilities(caps);
    if (byCaps !== "unknown") return { kind: byCaps, source: "capabilities" };
    return { kind: classifyByHeuristic(name), source: "heuristic" };
}
