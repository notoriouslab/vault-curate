/**
 * Strip the reasoning wrapper some models emit around the real answer.
 *
 * Ollama separates reasoning into its own `thinking` field (and we send
 * `think: false`), but OpenAI-compatible servers (e.g. mlx_lm.server) pass
 * it through verbatim: gpt-oss emits
 * `<|channel|>analysis … <|channel|>final<|message|>ANSWER`, Qwen-family
 * models emit `<think>…</think>ANSWER`.
 *
 * Without this the JSON parse fails and the description caller's
 * last-resort fallback writes the marker text into a note's frontmatter —
 * silent corruption rather than a visible error.
 *
 * Only text that STARTS with a marker enters the strip branch: a clean
 * JSON answer may legitimately contain a literal `</think>` in a string
 * value (notes about LLMs), and must pass through untouched. Inside the
 * branch, lastIndexOf is deliberate — models often echo the prompt's
 * format template during reasoning, so the first marker can be a
 * placeholder rather than the real answer.
 */
export function stripReasoningWrappers(text: string): string {
    const head = text.trimStart();
    if (!head.startsWith("<think>") && !head.startsWith("<|")) return text;

    const tidy = (s: string) => s.replace(/<\|(end|return|endoftext)\|>\s*$/g, "").trim();

    const FINAL = "<|channel|>final<|message|>";
    const f = text.lastIndexOf(FINAL);
    if (f !== -1) return tidy(text.slice(f + FINAL.length));

    const CLOSE_THINK = "</think>";
    const t = text.lastIndexOf(CLOSE_THINK);
    if (t !== -1) return tidy(text.slice(t + CLOSE_THINK.length));

    // Markers present but no final answer: the model ran out of budget
    // mid-thought. Fail loudly (the per-note catch turns this into a
    // Notice) instead of letting the fallback write marker text into a note.
    throw new Error("LLM returned reasoning with no final answer (token limit?)");
}
