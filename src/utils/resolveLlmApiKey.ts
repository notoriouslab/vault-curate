/**
 * The single definition of which API key AI curation sends (041).
 *
 * The embedding server and the AI curation server can be different
 * services (023), so each has its own key: `apiKey` for embeddings,
 * `llmApiKey` for AI curation. An empty `llmApiKey` reuses `apiKey` only
 * when AI curation also uses the embedding server (`llmUrl` empty), so a
 * key typed once for a shared server keeps working.
 *
 * Every AI curation request, probe, model list and warning must resolve
 * the key through this function. Only mergeSettings (the migration) and
 * the settings row that edits it read `llmApiKey` raw. A second fallback
 * definition is how the 022 pre-flight drift happened (see resolveLlmUrl).
 */

/** A settings value as a key string: strings are trimmed, finite numbers
 *  become their decimal text (1.14.1 sent `Bearer 12345` for them), anything
 *  else (null, undefined, objects, NaN) is "". */
export function keyText(x: unknown): string {
    if (typeof x === "string") return x.trim();
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    return "";
}

/** The key AI curation sends: its own key if set; else the embedding key
 *  when AI curation shares the embedding server (llmUrl empty); else none. */
export function resolveLlmApiKey(s: { llmApiKey?: unknown; llmUrl?: unknown; apiKey?: unknown }): string {
    const own = keyText(s.llmApiKey);
    if (own !== "") return own;
    return keyText(s.llmUrl) === "" ? keyText(s.apiKey) : "";
}
