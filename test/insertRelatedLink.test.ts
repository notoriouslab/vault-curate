import { describe, expect, it } from "vitest";
import { insertRelatedLink } from "../src/utils/insertRelatedLink";

const H = "## 相關筆記";

describe("insertRelatedLink", () => {
    it("appends after the section's last non-empty line, before the next heading", () => {
        const content = `# T\n\n${H}\n- [[Old]]\n\n## Next\nbody\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `# T\n\n${H}\n- [[Old]]\n- [[New]]\n\n## Next\nbody\n`,
        );
    });

    it("appends inside a section that runs to EOF", () => {
        const content = `body\n\n${H}\n- [[Old]]\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `body\n\n${H}\n- [[Old]]\n- [[New]]\n`,
        );
    });

    it("creates the section at EOF when missing, with one separating blank line", () => {
        expect(insertRelatedLink("body text\n", H, "[[New]]")).toBe(
            `body text\n\n${H}\n- [[New]]\n`,
        );
    });

    it("normalizes a file with no trailing newline before appending", () => {
        expect(insertRelatedLink("body text", H, "[[New]]")).toBe(
            `body text\n\n${H}\n- [[New]]\n`,
        );
    });

    it("writes heading + bullet directly into an empty file", () => {
        expect(insertRelatedLink("", H, "[[New]]")).toBe(`${H}\n- [[New]]\n`);
    });

    it("returns null when the section already contains the link (dedupe gate)", () => {
        const content = `${H}\n- [[New]]\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBeNull();
    });

    it("inserts right after the heading when the section is empty (next heading immediately follows)", () => {
        const content = `${H}\n## Next\nbody\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `${H}\n- [[New]]\n## Next\nbody\n`,
        );
    });

    it("matches the heading at file start and with surrounding whitespace", () => {
        const content = `${H}  \nold\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `${H}  \nold\n- [[New]]\n`,
        );
    });

    it("uses the first matching heading when duplicated", () => {
        const content = `${H}\n- a\n\n${H}\n- b\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `${H}\n- a\n- [[New]]\n\n${H}\n- b\n`,
        );
    });

    it("inserts before trailing blank lines of the section", () => {
        const content = `${H}\n- [[Old]]\n\n\n## Next\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `${H}\n- [[Old]]\n- [[New]]\n\n\n## Next\n`,
        );
    });

    it("handles alias links and markdown-style links as plain text", () => {
        const content = `${H}\n`;
        expect(insertRelatedLink(content, H, "[[A|alias]]")).toBe(
            `${H}\n- [[A|alias]]\n`,
        );
        expect(insertRelatedLink(`${H}\n- [B](B.md)\n`, H, "[B](B.md)")).toBeNull();
    });

    it("ignores the heading text inside a fenced code block (review W5)", () => {
        const content = "```md\n" + H + "\n```\nbody\n";
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            "```md\n" + H + "\n```\nbody\n\n" + H + "\n- [[New]]\n",
        );
    });

    it("ignores the heading text inside frontmatter and fences do not terminate sections", () => {
        const content = `---\ntitle: ${H}\n---\n${H}\n- [[Old]]\n\`\`\`\n# not a heading\n\`\`\`\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `---\ntitle: ${H}\n---\n${H}\n- [[Old]]\n\`\`\`\n# not a heading\n\`\`\`\n- [[New]]\n`,
        );
    });

    it("closes an EOF-unclosed fence before appending the new section (red-team F3)", () => {
        const content = "body\n```js\nconst x = 1\n";
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            "body\n```js\nconst x = 1\n```\n\n" + H + "\n- [[New]]\n",
        );
    });

    it("inserts above a fence that opens inside the section and never closes (red-team F3)", () => {
        const content = `${H}\n- [[Old]]\n\`\`\`\ndead zone\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `${H}\n- [[Old]]\n- [[New]]\n\`\`\`\ndead zone\n`,
        );
    });

    it("dedupe only scans the target section, not the whole file", () => {
        const content = `intro [[New]] mentioned inline\n\n${H}\n- [[Old]]\n`;
        expect(insertRelatedLink(content, H, "[[New]]")).toBe(
            `intro [[New]] mentioned inline\n\n${H}\n- [[Old]]\n- [[New]]\n`,
        );
    });
});
