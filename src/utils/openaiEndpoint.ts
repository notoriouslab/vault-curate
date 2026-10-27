/**
 * The single definition of an OpenAI-compatible endpoint URL.
 *
 * Users paste base URLs both with and without the `/v1` suffix (OpenRouter
 * documents `https://openrouter.ai/api/v1`; onboarding's own default is
 * `http://localhost:11434/v1`). Blindly appending `/v1/...` turned those
 * into `/v1/v1/...` and every request 404ed. Trailing slashes and one
 * trailing `/v1` are stripped before the path is appended, so both forms
 * reach the same endpoint.
 *
 * Every OpenAI-protocol request (model list, chat, embeddings, reachability
 * probes) must build its URL through this function.
 */
export function openaiEndpoint(base: string, path: string): string {
    const root = base.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    return `${root}/v1/${path.replace(/^\/+/, "")}`;
}
