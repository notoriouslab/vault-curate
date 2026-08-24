/**
 * Coerce the LLM's `tags` value into a raw list.
 *
 * Some models (measured: Qwen3.5-4B, 4/15 notes) return tags as one
 * separator-delimited string instead of a JSON array; treating non-arrays
 * as absent silently dropped those tags. Splits on whitespace, ASCII/CJK
 * commas and `、`. No count cap — the array path has none either, and the
 * two shapes must behave identically. Callers run their own per-tag
 * sanitation on the result.
 */
export function coerceTagList(tags: unknown): unknown[] {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === "string") return tags.split(/[\s,、，]+/).filter(Boolean);
    return [];
}
