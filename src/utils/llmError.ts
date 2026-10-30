/**
 * Why an AI curation request failed, in words a notice can show (issue #19).
 *
 * Hosted servers such as OpenRouter reject requests (wrong key, no credits,
 * a retired model) without listing them anywhere the user can see, and the
 * notice used to say only "LLM failed", so the reason sat in the console.
 */

const MAX_REASON_CHARS = 160;

function oneLine(text: string, max: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max) + "..." : flat;
}

/** The message inside an error response body: `{"error":{"message"}}`
 *  (OpenAI, OpenRouter), `{"error":"..."}` (Ollama), `{"message"}` or
 *  `{"detail"}`; anything else is the raw text. */
export function apiErrorMessage(body: string, max = 200): string {
    try {
        const data: unknown = JSON.parse(body);
        if (typeof data === "object" && data !== null) {
            const d = data as { error?: unknown; message?: unknown; detail?: unknown };
            const err = d.error;
            if (typeof err === "object" && err !== null) {
                const msg = (err as { message?: unknown }).message;
                if (typeof msg === "string" && msg.trim()) return oneLine(msg, max);
            }
            for (const v of [err, d.message, d.detail]) {
                if (typeof v === "string" && v.trim()) return oneLine(v, max);
            }
        }
    } catch {
        // Not JSON: fall through to the raw text.
    }
    return oneLine(body, max);
}

/** A thrown value as a short reason, without the "LLM " prefix that
 *  requestLlmJson puts on its own errors ("LLM 402: ..." → "402: ..."). */
export function llmFailureReason(e: unknown): string {
    const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    return oneLine(text.replace(/^LLM\s+/, ""), MAX_REASON_CHARS);
}
