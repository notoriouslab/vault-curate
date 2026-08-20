/**
 * 017 Task 2: text-node tolerance — expand/promote already type-guard on
 * n.type === "file" (G1 audit verified); these tests pin that behavior so
 * the results-canvas text center (or any user-typed text node) can never
 * regress them. Expected code change: zero.
 */
import { describe, it, expect } from 'vitest';
import { buildResultsCanvas, type GraphNeighborInput } from '../src/canvas/graphCanvas';
import { expandCanvas } from '../src/canvas/expandCanvas';
import { collectPurpleEdges } from '../src/canvas/promote';

const results: GraphNeighborInput[] = [
    { path: 'notes/a.md', tier: 'hot', score: 0.9 },
    { path: 'notes/b.md', tier: 'hot', score: 0.8 },
];
const NO_LINKS = {};

describe('文字節點容忍度（017 Task 2）', () => {
    it('expandCanvas：以結果節點為中心展開——文字節點原樣保留、座標不動、不被覆寫', () => {
        const canvas = buildResultsCanvas('登山', results);
        const textBefore = canvas.nodes.find(n => n.type === 'text')!;
        const r = expandCanvas(canvas, 'notes/a.md',
            [{ path: 'notes/c.md', tier: 'hot', score: 0.7 }], NO_LINKS);
        const textAfter = r.canvas.nodes.find(n => n.type === 'text')!;
        expect(textAfter).toEqual(textBefore);          // 內容與座標全等
        expect(r.added).toBe(1);                        // 展開照常運作
        expect(r.canvas.nodes.filter(n => n.type === 'text')).toHaveLength(1);
    });

    it('expandCanvas：文字節點不參與相似度、新節點佈局避開它（obstacles 含其座標）', () => {
        const canvas = buildResultsCanvas('登山', results);
        const text = canvas.nodes.find(n => n.type === 'text')!;
        const r = expandCanvas(canvas, 'notes/a.md',
            [{ path: 'notes/d.md', tier: 'hot', score: 0.6 }], NO_LINKS);
        const added = r.canvas.nodes.find(n => n.type === 'file' && n.file === 'notes/d.md')!;
        // 新節點與文字中心不重疊（AABB 分離）
        const overlap = !(added.x + added.width < text.x || text.x + text.width < added.x
            || added.y + added.height < text.y || text.y + text.height < added.y);
        expect(overlap).toBe(false);
    });

    it('collectPurpleEdges：文字節點連的邊（綠色相關度邊）不進紫邊清單', () => {
        const canvas = buildResultsCanvas('登山', results);
        const pairs = collectPurpleEdges(canvas, NO_LINKS, () => true);
        expect(pairs).toHaveLength(0); // 中心邊全綠且端點非 file → 零紫邊候選
    });
});
