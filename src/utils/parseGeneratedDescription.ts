import { coerceTagList } from "./coerceTagList";
import { DESCRIPTION_LENGTH_CAP, TAG_LENGTH_CAP, safeSlice, stripDangerousInvisibles } from "./sanitize";

/**
 * Parse an LLM description/tags reply into a sanitized frontmatter payload.
 * Pure (no obsidian import) so it is unit-testable — the 1.6.0 red-team pass
 * showed the last-resort fallback was the one path that skipped sanitation.
 */
export function parseGeneratedDescription(raw: string): { description: string; tags?: string[] } {
    const tryParse = (text: string): { description: string; tags?: string[] } | null => {
        try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) return null;
            const obj = parsed as { description?: unknown; summary?: unknown; tags?: unknown };
            const descRaw = typeof obj.description === "string"
                ? obj.description
                : typeof obj.summary === "string"
                    ? obj.summary
                    : "";
            // Strip control + C1 + line-separator code points before any
            // further use — a poisoned LLM response could otherwise smuggle
            // ANSI escapes, YAML-confusing line breaks, or invisible chars
            // into frontmatter.
            const desc = safeSlice(stripDangerousInvisibles(descRaw, " "), DESCRIPTION_LENGTH_CAP);
            const cleanedTags = coerceTagList(obj.tags)
                .map((s) => String(s))
                .map((s) => stripDangerousInvisibles(s).replace(/\s+/g, "_"))
                .map((s) => safeSlice(s, TAG_LENGTH_CAP))
                .filter((s) => s !== "..." && s !== "…" && s.length > 0);
            const tags = cleanedTags.length > 0 ? cleanedTags : undefined;
            return { description: desc, tags };
        } catch { return null; }
    };

    // Last-resort fallback (neither parse produced JSON — a chatty model,
    // a refusal, malformed JSON). Run the SAME invisible/control-char
    // stripping the JSON path does: otherwise ANSI escapes, NUL/CR, and
    // Plane-14 tag chars in a non-JSON reply land verbatim in the note's
    // frontmatter (1.6.0 red-team §4). safeSlice first keeps the strip
    // bounded regardless of reply length.
    return tryParse(raw)
        ?? tryParse(raw.replace(/```json\n?|\n?```/g, "").trim())
        ?? { description: stripDangerousInvisibles(safeSlice(raw, DESCRIPTION_LENGTH_CAP), " ") };
}
