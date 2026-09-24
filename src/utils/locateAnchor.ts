/**
 * Find the line a search snippet came from (034 D4). The anchor is raw text
 * copied from the matched chunk; searching the file as it is now (instead of
 * storing an offset at index time) keeps the jump correct after edits, and
 * simply yields null once the passage is gone.
 *
 * The frontmatter is skipped (descriptions often repeat the first sentence),
 * and when the anchor occurs more than once the occurrence closest to where
 * it should sit (its chunk's share of the body, plus its position within
 * that chunk) wins.
 */
export function locateAnchor(
    content: string,
    anchor: string,
    chunkIndex: number | null,
    chunkCount: number | null,
    anchorRatio: number | null = 0,
): number | null {
    const pos = locateAnchorOffset(content, anchor, chunkIndex, chunkCount, anchorRatio);
    if (pos === null) return null;
    let line = 0;
    for (let i = content.indexOf('\n'); i >= 0 && i < pos; i = content.indexOf('\n', i + 1)) line++;
    return line;
}

/** Same search as locateAnchor, returning the UTF-16 offset in `content`. */
export function locateAnchorOffset(
    content: string,
    anchor: string,
    chunkIndex: number | null,
    chunkCount: number | null,
    anchorRatio: number | null = 0,
): number | null {
    if (!anchor) return null;
    const bodyStart = frontmatterEnd(content);
    const hits: number[] = [];
    for (let i = content.indexOf(anchor, bodyStart); i >= 0; i = content.indexOf(anchor, i + 1)) {
        hits.push(i);
    }
    if (hits.length === 0) return null;

    let pos = hits[0];
    if (hits.length > 1 && chunkIndex !== null && chunkCount) {
        // Chunk start plus the anchor's position inside that chunk.
        const estimate = bodyStart + (chunkIndex + (anchorRatio ?? 0)) * ((content.length - bodyStart) / chunkCount);
        for (const h of hits) {
            if (Math.abs(h - estimate) < Math.abs(pos - estimate)) pos = h;
        }
    }
    return pos;
}

/**
 * The ephemeral state Obsidian's own search opens a match with:
 * `{ content, matches: [[start, end]] }`, offsets into the file text. Both
 * reading and editing views scroll a match to the centre and flash it
 * (checked against Obsidian 1.13.7's MarkdownView / edit and preview modes),
 * which a bare `line` did not reliably do. The range covers the anchor's
 * first non-blank line so the flash lands on the hit.
 */
export function anchorMatch(
    content: string,
    anchor: string,
    chunkIndex: number | null,
    chunkCount: number | null,
    anchorRatio: number | null = 0,
): { content: string; matches: Array<[number, number]> } | null {
    const pos = locateAnchorOffset(content, anchor, chunkIndex, chunkCount, anchorRatio);
    if (pos === null) return null;
    const lead = anchor.search(/\S/);
    if (lead < 0) return null;
    const nl = anchor.indexOf('\n', lead);
    return { content, matches: [[pos + lead, pos + (nl < 0 ? anchor.length : nl)]] };
}

/** Offset just past the closing frontmatter fence; same rule as stripFrontmatter (utils.ts). */
function frontmatterEnd(content: string): number {
    if (!content.startsWith('---')) return 0;
    const end = content.indexOf('---', 3);
    return end === -1 ? 0 : end + 3;
}
