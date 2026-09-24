import { describe, it, expect } from 'vitest';
import { locateAnchor, anchorMatch } from '../src/utils/locateAnchor';

describe('locateAnchor', () => {
    it('ignores a copy of the anchor inside the frontmatter', () => {
        const content = '---\ndescription: 目標句在這裡\n---\n第一行\n第二行\n目標句在這裡\n';
        expect(locateAnchor(content, '目標句在這裡', 0, 1)).toBe(5);
    });

    it('picks the occurrence nearest the chunk it came from', () => {
        const filler = '字'.repeat(200);
        const content = `重複句\n${filler}\n${filler}\n重複句\n${filler}`;
        // chunk 1 of 2 sits in the second half of the body: the second copy (line 3).
        expect(locateAnchor(content, '重複句', 1, 2)).toBe(3);
        expect(locateAnchor(content, '重複句', 0, 2)).toBe(0);
    });

    it('uses the anchor position within its chunk to pick between copies', () => {
        const filler = '字'.repeat(200);
        // Two copies inside chunk 0 of 1: the one near the chunk end wins when
        // the anchor sat at the end of its chunk.
        const content = `重複句\n${filler}\n${filler}\n重複句`;
        expect(locateAnchor(content, '重複句', 0, 1, 0.99)).toBe(3);
        expect(locateAnchor(content, '重複句', 0, 1, 0)).toBe(0);
    });

    it('returns null when the anchor is gone (edited since indexing)', () => {
        expect(locateAnchor('完全不同的內容', '目標句', 0, 1)).toBeNull();
    });

    it('counts lines correctly in a CRLF file', () => {
        const content = '第一行\r\n第二行\r\n目標在第三行\r\n';
        expect(locateAnchor(content, '目標在第三行', 0, 1)).toBe(2);
    });

    it('builds the match Obsidian search opens with, on the anchor\'s first non-blank line', () => {
        const content = '---\ntitle: x\n---\n前文\n\n  | 巽正 | 周巽正 |\n| 區牧師 | 區永亮 |\n';
        const anchor = '\n  | 巽正 | 周巽正 |\n| 區牧師';
        const m = anchorMatch(content, anchor, 0, 1)!;
        const [a, b] = m.matches[0];
        expect(m.content).toBe(content);
        expect(content.slice(a, b)).toBe('| 巽正 | 周巽正 |');
    });

    it('gives no match for a missing or blank anchor', () => {
        expect(anchorMatch('內容', '找不到', 0, 1)).toBeNull();
        expect(anchorMatch('   \n  ', '  \n', 0, 1)).toBeNull();
    });
});
