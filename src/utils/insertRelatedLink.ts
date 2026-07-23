// Related-section insertion (010 D3) — pure string transform, no Obsidian
// imports. Wikilinks MUST land in the note body (not frontmatter): the
// rescued note's own text keeps a visible trail, and body links are what
// resolvedLinks / graph view are guaranteed to see.

/** A markdown heading line of any level. */
const HEADING_RE = /^#{1,6}\s/;

/** Lines that can never be a real heading: inside YAML frontmatter or a
 *  fenced code block (a markdown-tutorial note can contain the literal
 *  heading text in a fence — matching it would bury the link where
 *  resolvedLinks never sees it, review W5). A fence still open at EOF is
 *  reported (marker + start line): Obsidian renders it as code all the way
 *  down, so anything appended after it is a dead link (red-team F3). */
function maskedLines(lines: string[]): {
    masked: boolean[];
    openFence: string | null;
    openFenceStart: number;
} {
    const masked = new Array<boolean>(lines.length).fill(false);
    let i = 0;
    if (lines[0]?.trim() === "---") {
        masked[0] = true;
        for (i = 1; i < lines.length; i++) {
            masked[i] = true;
            if (lines[i].trim() === "---") { i++; break; }
        }
    }
    let fence: string | null = null;
    let fenceStart = -1;
    for (; i < lines.length; i++) {
        const open = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence !== null) {
            masked[i] = true;
            if (open && open[1][0] === fence[0] && open[1].length >= fence.length) {
                fence = null;
            }
        } else if (open) {
            fence = open[1];
            fenceStart = i;
            masked[i] = true;
        }
    }
    return {
        masked,
        openFence: fence,
        openFenceStart: fence !== null ? fenceStart : -1,
    };
}

/**
 * Insert `- {linkText}` into the section titled `sectionHeading` (line
 * compared with trim on both sides — 1-3 leading spaces still parse as a
 * heading, trailing spaces are invisible). Frontmatter and fenced code
 * lines never match, and never terminate a section. First matching
 * heading wins. The section ends at the next heading of ANY level or EOF;
 * the bullet goes after the section's last non-empty line (right after
 * the heading when the section is blank). Missing section ⇒ appended at
 * EOF with one separating blank line.
 *
 * Returns the new content, or null when the section already contains
 * `linkText` (second dedupe gate — the first is the caller's
 * resolvedLinks filter).
 */
export function insertRelatedLink(
    content: string,
    sectionHeading: string,
    linkText: string,
): string | null {
    const heading = sectionHeading.trim();
    const bullet = `- ${linkText}`;
    const lines = content.split("\n");
    const { masked, openFence, openFenceStart } = maskedLines(lines);

    let headingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (!masked[i] && lines[i].trim() === heading) {
            headingIdx = i;
            break;
        }
    }

    if (headingIdx === -1) {
        // Append a fresh section at EOF, normalizing the tail to exactly
        // one blank separator line and a trailing newline. A fence still
        // open at EOF must be closed first — the note is already broken,
        // but appending inside it would render our section as code and
        // the wikilink would never resolve (red-team F3).
        const trimmed = content.replace(/\n+$/, "");
        const closer = openFence !== null ? `${openFence}\n` : "";
        return trimmed === ""
            ? `${heading}\n${bullet}\n`
            : `${trimmed}\n${closer}\n${heading}\n${bullet}\n`;
    }

    let sectionEnd = lines.length; // exclusive
    for (let i = headingIdx + 1; i < lines.length; i++) {
        if (!masked[i] && HEADING_RE.test(lines[i])) {
            sectionEnd = i;
            break;
        }
    }

    for (let i = headingIdx + 1; i < sectionEnd; i++) {
        if (lines[i].includes(linkText)) return null;
    }

    let insertAt = headingIdx + 1;
    for (let i = sectionEnd - 1; i > headingIdx; i--) {
        if (lines[i].trim() !== "") {
            insertAt = i + 1;
            break;
        }
    }

    // Section runs into a fence that never closes: the natural insertion
    // point is inside dead code territory — insert just above the broken
    // fence instead (red-team F3 variant).
    if (openFence !== null && openFenceStart > headingIdx && insertAt > openFenceStart) {
        insertAt = openFenceStart;
    }

    lines.splice(insertAt, 0, bullet);
    return lines.join("\n");
}
