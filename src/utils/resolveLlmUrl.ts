/**
 * The single definition of which server AI curation talks to.
 *
 * Embedding and the curation LLM historically shared one URL, which
 * breaks when the LLM lives on a server that doesn't serve embeddings
 * (mlx_lm.server 404s /v1/embeddings while chat works fine). `llmUrl`
 * is the optional override for the LLM side only; empty or whitespace
 * means "same server as embedding" so existing setups behave exactly
 * as before. Trailing slashes are stripped to match checkLLMReachable's
 * endpoint normalization.
 *
 * Every LLM consumer (curation pre-flight and calls, MOC naming, the
 * settings status line and model dropdown) must resolve through this
 * function — a second fallback definition is how the 022 pre-flight
 * drift happened.
 */
export function resolveLlmUrl(llmUrl: string | undefined, ollamaUrl: string): string {
    const chosen = (llmUrl ?? "").trim();
    return (chosen === "" ? ollamaUrl : chosen).replace(/\/+$/, "");
}
