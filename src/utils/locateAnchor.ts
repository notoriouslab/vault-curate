/**
 * Find the line a search snippet came from (034 D4). The anchor is raw text
 * copied from the matched chunk; searching the file as it is now (instead of
 * storing an offset at index time) keeps the jump correct after edits, and
 * simply yields null once the passage is gone.
 *
 * The frontmatter is skipped (descriptions often repeat the first sentence),
 * and when the anchor occurs more than once the occurrence closest to where
 * the chunk should sit (chunkIndex / chunkCount of the body) wins.
 */
export function locateAnchor(
    content: string,
    anchor: string,
    chunkIndex: number | null,
    chunkCount: number | null,
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
        const estimate = bodyStart + chunkIndex * ((content.length - bodyStart) / chunkCount);
        for (const h of hits) {
            if (Math.abs(h - estimate) < Math.abs(pos - estimate)) pos = h;
        }
    }
    let line = 0;
    for (let i = content.indexOf('\n'); i >= 0 && i < pos; i = content.indexOf('\n', i + 1)) line++;
    return line;
}

/** Offset just past the closing frontmatter fence; same rule as stripFrontmatter (utils.ts). */
function frontmatterEnd(content: string): number {
    if (!content.startsWith('---')) return 0;
    const end = content.indexOf('---', 3);
    return end === -1 ? 0 : end + 3;
}
