// What the description LLM gets to read (040 D1). Pure — no obsidian import —
// so the sampling rules are unit-testable.
//
// The old head 1200 + tail 800 chars left most of a long note unseen, and the
// model filled the gap by guessing (pilot: most factual errors came from that
// arm). Six evenly spread segments inside a token budget read the whole note
// at the same cost class, and the head and tail are still among the segments,
// so template-heavy notes keep their personal content in view (007 D6).

export const LLM_INPUT_TOKEN_BUDGET = 3000;
export const LLM_INPUT_SEGMENTS = 6;
export const SAMPLE_SEP = "\n…\n";

// Conservative per-code-point weights. gemma3 measured ~0.27 tokens per ASCII
// char, 0.75-0.8 per Chinese char and ~1.0 for mixed technical text; 0.6 for
// CJK under-counted and overflowed num_ctx (empty replies). Every non-ASCII
// BMP char counts 1.0 so Cyrillic, Thai etc. are not under-counted either.
function weight(cp: number): number {
    if (cp < 0x80) return 0.3;
    return cp > 0xffff ? 2 : 1;
}

export function estimateTokens(text: string): number {
    let w = 0;
    for (const ch of text) w += weight(ch.codePointAt(0)!);
    return w;
}

/** Drop URLs before the text goes to the LLM; imported Blogger notes were
 *  55-72% URL. Bare URLs stop at the first non-ASCII char so Chinese written
 *  right after a link survives. Index text (denoiseForEmbed) is untouched.
 *  Known limits: "- [ ]" loses its brackets and "(url)," loses "),". */
export function stripUrlsForLlm(text: string): string {
    return text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\((?:https?:|obsidian:)[^)]*\)/g, "$1")
        .replace(/<https?:[^>]*>/g, "")
        .replace(/https?:\/\/[\x21-\x7E]+/g, "")
        .replace(/\[\s*\]/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
}

/**
 * Whole text if it fits the budget; otherwise n segments starting at evenly
 * spaced code points. Each segment takes its share of the budget (separators
 * included, so the result stays within budget) but never runs past the next
 * segment's start, so low-density stretches cannot overlap their neighbour.
 */
export function sampleSpread(
    text: string,
    budget: number = LLM_INPUT_TOKEN_BUDGET,
    n: number = LLM_INPUT_SEGMENTS,
): string {
    if (estimateTokens(text) <= budget) return text;
    const cps = Array.from(text);
    const len = cps.length;
    const per = (budget - (n - 1) * estimateTokens(SAMPLE_SEP)) / n;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
        const start = Math.floor((len * i) / n);
        const limit = i < n - 1 ? Math.floor((len * (i + 1)) / n) : len;
        let used = 0;
        let end = start;
        while (end < limit) {
            const w = weight(cps[end].codePointAt(0)!);
            if (used + w > per) break;
            used += w;
            end++;
        }
        parts.push(cps.slice(start, end).join(""));
    }
    return parts.join(SAMPLE_SEP);
}
