/**
 * 017 Task 1: buildResultsCanvas — the query-centered star. Pinned choices:
 * green relevance edges (never gray = "linked", never purple = "unlinked
 * pair"), Markdown-safe center text, layout identical to relation graphs.
 */
import { describe, it, expect } from 'vitest';
import {
    buildResultsCanvas,
    buildGraphCanvas,
    markdownSafeQuery,
    sanitizeQueryBasename,
    resultsCanvasFileName,
    COLOR_RELEVANCE,
    COLOR_CENTER,
    COLOR_COLD,
    type GraphNeighborInput,
} from '../src/canvas/graphCanvas';

const mkResults = (n: number): GraphNeighborInput[] =>
    Array.from({ length: n }, (_, i) => ({
        path: `notes/r${i}.md`,
        tier: i === 2 ? 'cold' as const : 'hot' as const,
        score: 0.9 - i * 0.05,
    }));

describe('buildResultsCanvas（017 Task 1）', () => {
    it('斷言 1：12 結果 → 13 節點（1 text + 12 file）、12 邊全綠 "4" 無箭頭、label=兩位小數', () => {
        const c = buildResultsCanvas('登山裝備', mkResults(12));
        expect(c.nodes).toHaveLength(13);
        expect(c.nodes.filter(n => n.type === 'text')).toHaveLength(1);
        expect(c.nodes.filter(n => n.type === 'file')).toHaveLength(12);
        expect(c.edges).toHaveLength(12);
        for (const e of c.edges) {
            expect(e.color).toBe(COLOR_RELEVANCE);
            expect(e.fromEnd).toBe('none');
            expect(e.toEnd).toBe('none');
            expect(e.label).toMatch(/^\d\.\d\d$/);
        }
    });

    it('斷言 2：結果節點座標與 buildGraphCanvas 同輸入一致（layout 重用鐵證）', () => {
        const results = mkResults(7);
        const rc = buildResultsCanvas('q', results);
        const gc = buildGraphCanvas({ path: 'center.md', tier: 'hot' }, results, {});
        const fileXY = (c: { nodes: { type: string; x: number; y: number }[] }) =>
            c.nodes.filter(n => n.type === 'file' && 'file' in n).map(n => [n.x, n.y]);
        // buildGraphCanvas 的 file 節點含中心；去掉中心後比對
        const gcNeighbors = gc.nodes.slice(1).map(n => [n.x, n.y]);
        expect(fileXY(rc).slice(0, 7)).toEqual(gcNeighbors);
    });

    it('斷言 3：cold 帶青色；中心→結果邊統一綠，不因該結果與中心有無 wikilink 而變色', () => {
        const c = buildResultsCanvas('q', mkResults(5));
        const files = c.nodes.filter(n => n.type === 'file');
        expect(files[2].color).toBe(COLOR_COLD);
        // buildResultsCanvas 不收 links——邊色由建構保證恆綠（型別層即無 link 輸入）
        expect(new Set(c.edges.map(e => e.color))).toEqual(new Set([COLOR_RELEVANCE]));
        // 中心是綠錨點（COLOR_CENTER 同語意家族）
        expect(c.nodes[0].color).toBe(COLOR_CENTER);
    });

    it('斷言 4：空結果 throw', () => {
        expect(() => buildResultsCanvas('q', [])).toThrow(/non-empty/);
    });

    it('斷言 5：中心文字 Markdown 安全——#/反引號/[[ 都以 inline code 原樣呈現', () => {
        expect(markdownSafeQuery('#標籤')).toBe('🔍 `#標籤`');
        expect(markdownSafeQuery('[[wiki]]')).toBe('🔍 `[[wiki]]`');
        const withTick = markdownSafeQuery('a `code` b');
        expect(withTick).toBe('🔍 ``a `code` b``'); // fence 比內部最長 run 長一級
        const edgeTick = markdownSafeQuery('`lead');
        expect(edgeTick.startsWith('🔍 `` `lead')).toBe(true); // 首尾反引號要 pad
    });
});

describe('sanitizeQueryBasename / resultsCanvasFileName', () => {
    it('全濾除字元查詢 → 濾後才 fallback "search"（紅隊 C2）', () => {
        expect(sanitizeQueryBasename(':::')).toBe('search');
        expect(sanitizeQueryBasename('  ')).toBe('search');
        expect(sanitizeQueryBasename('...')).toBe('search');
    });
    it('code point 裁 24 字，emoji 不產生孤立 surrogate（紅隊 W3）', () => {
        const q = '🔍'.repeat(30);
        const out = sanitizeQueryBasename(q);
        expect(Array.from(out)).toHaveLength(24);
        expect(out).not.toMatch(/[\uD800-\uDBFF]$/); // 尾端無孤立 high surrogate
    });
    it('控制字元／Tab／零寬字元不進檔名（ship 前紅隊稽核）', () => {
        // Windows 上 0x00-0x1F 是非法檔名字元，vault.create 會丟例外；
        // 零寬字元則是看不見卻真的存在的檔名雜訊。
        expect(sanitizeQueryBasename('a\u0007bc')).toBe('a bc');
        expect(sanitizeQueryBasename('a\tb')).toBe('a b');
        expect(sanitizeQueryBasename('a\u200bb')).toBe('a b');
        expect(sanitizeQueryBasename('a\u200e\u200fb')).toBe('a  b');
        // 全是控制字元 → 濾後為空 → 照既有規則 fallback
        expect(sanitizeQueryBasename('\u0001\u0002')).toBe('search');
        // emoji 不能被誤判成格式字元砍掉
        expect(sanitizeQueryBasename('\u{1F600}a')).toBe('\u{1F600}a');
    });

    it('非法字元換空白、前導點剝除', () => {
        expect(sanitizeQueryBasename('a/b:c')).toBe('a b c');
        expect(sanitizeQueryBasename('..hidden')).toBe('hidden');
    });
    it('檔名用 search 標記且撞名遞增', () => {
        const existing = new Set(['q · search · 2026-08-06 1200.canvas']);
        expect(resultsCanvasFileName('q', '2026-08-06 1200', existing))
            .toBe('q · search · 2026-08-06 1200-2.canvas');
    });
});
