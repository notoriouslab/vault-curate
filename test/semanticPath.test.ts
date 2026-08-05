import { describe, it, expect } from 'vitest';
import { buildKnnGraph, widestPath, edgeSimPercentile, type KnnGraph } from '../src/search/semanticPath';

/** 手工鄰接表（雙向對稱）。 */
function g(edges: Array<[string, string, number]>): KnnGraph {
    const graph: KnnGraph = new Map();
    const ensure = (p: string) => { if (!graph.has(p)) graph.set(p, []); };
    for (const [a, b, sim] of edges) {
        ensure(a); ensure(b);
        graph.get(a)!.push({ path: b, sim });
        graph.get(b)!.push({ path: a, sim });
    }
    return graph;
}

describe('widestPath — 瓶頸路徑（009 D2）', () => {
    it('瓶頸最大性：直路含弱邊 vs 繞路全強邊 → 選繞路', () => {
        const graph = g([
            ['A', 'E', 0.4],              // 直連但弱
            ['A', 'B', 0.9], ['B', 'C', 0.85], ['C', 'E', 0.9], // 繞路全強
        ]);
        const r = widestPath(graph, 'A', 'E');
        expect(r!.path).toEqual(['A', 'B', 'C', 'E']);
        expect(r!.bottleneck).toBeCloseTo(0.85, 6);
        expect(r!.sims).toEqual([0.9, 0.85, 0.9]);
    });

    it('直連一跳：強直連勝過繞路', () => {
        const graph = g([
            ['A', 'E', 0.95],
            ['A', 'B', 0.9], ['B', 'E', 0.9],
        ]);
        const r = widestPath(graph, 'A', 'E');
        expect(r!.path).toEqual(['A', 'E']);
        expect(r!.bottleneck).toBeCloseTo(0.95, 6);
    });

    it('瓶頸同分 → 跳數少者勝', () => {
        const graph = g([
            ['A', 'E', 0.8],
            ['A', 'B', 0.8], ['B', 'E', 0.9],
        ]);
        const r = widestPath(graph, 'A', 'E');
        expect(r!.path).toEqual(['A', 'E']); // 一跳，瓶頸同為 0.8
    });

    it('瓶頸同分同跳數 → 路徑鍵字典序決定（決定性）', () => {
        const graph = g([
            ['A', 'B', 0.8], ['B', 'E', 0.8],
            ['A', 'C', 0.8], ['C', 'E', 0.8],
        ]);
        const r1 = widestPath(graph, 'A', 'E');
        const r2 = widestPath(graph, 'A', 'E');
        expect(r1!.path).toEqual(['A', 'B', 'E']); // "A\nB\nE" < "A\nC\nE"
        expect(r2!.path).toEqual(r1!.path);        // 重複呼叫全等
    });

    it('maxHops 截斷：唯一路徑超過上限 → null', () => {
        const graph = g([
            ['A', 'B', 0.9], ['B', 'C', 0.9], ['C', 'D', 0.9], ['D', 'E', 0.9],
        ]);
        expect(widestPath(graph, 'A', 'E', 2)).toBeNull();
        expect(widestPath(graph, 'A', 'E', 4)).not.toBeNull();
    });

    it('不連通 → null', () => {
        const graph = g([['A', 'B', 0.9], ['X', 'Y', 0.9]]);
        expect(widestPath(graph, 'A', 'X')).toBeNull();
    });

    it('自環拒絕：from === to → null', () => {
        const graph = g([['A', 'B', 0.9]]);
        expect(widestPath(graph, 'A', 'A')).toBeNull();
    });

    it('端點不在圖上 → null', () => {
        const graph = g([['A', 'B', 0.9]]);
        expect(widestPath(graph, 'A', 'Z')).toBeNull();
        expect(widestPath(graph, 'Z', 'A')).toBeNull();
    });

    it('對稱性：widest(A,E) 與 widest(E,A) 瓶頸值相等（路徑允許不同）', () => {
        const graph = g([
            ['A', 'B', 0.8], ['B', 'E', 0.7],
            ['A', 'C', 0.7], ['C', 'E', 0.8],
            ['A', 'E', 0.5],
        ]);
        const f = widestPath(graph, 'A', 'E');
        const b = widestPath(graph, 'E', 'A');
        expect(f!.bottleneck).toBeCloseTo(b!.bottleneck, 9);
    });
});

describe('buildKnnGraph（009 D1）', () => {
    // 2D 單位向量：夾角小 → cosine 高
    const v = (deg: number) => {
        const r = (deg * Math.PI) / 180;
        return new Float32Array([Math.cos(r), Math.sin(r)]);
    };

    it('top-K 與雙向聯集：K=1 時仍可能因對方選中而有多條邊', () => {
        const notes = [
            { path: 'a', vec: v(0) },
            { path: 'b', vec: v(10) },  // a 的最近鄰
            { path: 'c', vec: v(80) },  // c 的最近鄰是 b
        ];
        const graph = buildKnnGraph(notes, 1);
        const aEdges = graph.get('a')!.map(e => e.path);
        expect(aEdges).toEqual(['b']);
        const bEdges = graph.get('b')!.map(e => e.path).sort();
        expect(bEdges).toEqual(['a', 'c']); // b←a 的選擇 + b←c 的選擇（聯集）
    });

    it('對稱：邊兩端都看得到彼此、sim 相同', () => {
        const notes = [
            { path: 'a', vec: v(0) },
            { path: 'b', vec: v(30) },
        ];
        const graph = buildKnnGraph(notes, 1);
        const ab = graph.get('a')!.find(e => e.path === 'b')!;
        const ba = graph.get('b')!.find(e => e.path === 'a')!;
        expect(ab.sim).toBeCloseTo(ba.sim, 9);
        expect(ab.sim).toBeCloseTo(Math.cos(Math.PI / 6), 5);
    });

    it('k=0 → 空邊圖；單節點不 throw', () => {
        expect(buildKnnGraph([{ path: 'a', vec: v(0) }], 5).get('a')).toEqual([]);
        const graph = buildKnnGraph([{ path: 'a', vec: v(0) }, { path: 'b', vec: v(1) }], 0);
        expect(graph.get('a')).toEqual([]);
    });

    it('sameFolderCap：同資料夾超額跳過、跨資料夾遞補（008 語意）', () => {
        // f/ 資料夾 4 兄弟緊靠 0°，跨資料夾 x 在 40°。K=3：
        // 無 cap → a 的三個名額全被兄弟吃掉；cap=2 → 第三名額遞補給 x。
        const notes = [
            { path: 'f/a', vec: v(0) },
            { path: 'f/b', vec: v(2) },
            { path: 'f/c', vec: v(4) },
            { path: 'f/d', vec: v(6) },
            { path: 'x', vec: v(40) },
        ];
        const noCap = buildKnnGraph(notes, 3);
        expect(noCap.get('f/a')!.map(e => e.path).sort()).toEqual(['f/b', 'f/c', 'f/d']);

        const capped = buildKnnGraph(notes, 3, 2);
        const aEdges = capped.get('f/a')!.map(e => e.path).sort();
        expect(aEdges).toContain('x');           // 跨資料夾遞補進場
        expect(aEdges).toEqual(['f/b', 'f/c', 'x']); // 兄弟只留最強 2 個
    });

    it('sameFolderCap=0（預設）行為與無 cap 完全相同', () => {
        const notes = [
            { path: 'f/a', vec: v(0) },
            { path: 'f/b', vec: v(5) },
            { path: 'g/c', vec: v(30) },
        ];
        const a = buildKnnGraph(notes, 2);
        const b = buildKnnGraph(notes, 2, 0);
        expect(b).toEqual(a);
    });

    it('sameFolderCap：root 筆記（無資料夾）彼此也受 cap 約束', () => {
        const notes = [
            { path: 'a', vec: v(0) },
            { path: 'b', vec: v(2) },
            { path: 'c', vec: v(4) },
            { path: 'f/x', vec: v(30) },
        ];
        const capped = buildKnnGraph(notes, 2, 1);
        // a 的 2 個名額：root 兄弟只能占 1（b），遞補 f/x
        expect(capped.get('a')!.map(e => e.path).sort()).toEqual(['b', 'f/x']);
    });

    // 門檻 3s 而非 1s：全套件並行時 worker 搶 CPU，單獨跑 ~0.3s 的本測試
    // 會膨脹到 1.1-2.6s（實測），1s 門檻抓的是機器負載不是回歸。
    // 真正要擋的複雜度回歸（如 O(n²k) 變 O(n³)）在 1k 節點下是數十秒起跳，
    // 3s 仍然擋得住。
    it('效能：1k 節點建圖 + 尋路 < 3s', () => {
        const notes = Array.from({ length: 1000 }, (_, i) => {
            const vec = new Float32Array(64);
            for (let d = 0; d < 64; d++) vec[d] = Math.sin(i * 37.1 + d * 5.3);
            let n = 0;
            for (let d = 0; d < 64; d++) n += vec[d] * vec[d];
            n = Math.sqrt(n);
            for (let d = 0; d < 64; d++) vec[d] /= n;
            return { path: `n${i}`, vec };
        });
        const t0 = performance.now();
        const graph = buildKnnGraph(notes, 10);
        widestPath(graph, 'n0', 'n999');
        expect(performance.now() - t0).toBeLessThan(3000);
    });
});

describe('edgeSimPercentile（009 D4 判定門檻）', () => {
    // 期望值全部以 numpy np.percentile（linear interpolation）當日對照鎖定
    it('numpy 等價：單邊 / 兩邊 / 三邊 / 四邊 @ p45', () => {
        expect(edgeSimPercentile(g([['a', 'b', 0.5]]), 45)).toBeCloseTo(0.5, 9);
        expect(edgeSimPercentile(g([['a', 'b', 0.1], ['c', 'd', 0.9]]), 45))
            .toBeCloseTo(0.46, 9);
        expect(edgeSimPercentile(g([['a', 'b', 0.1], ['c', 'd', 0.5], ['e', 'f', 0.9]]), 45))
            .toBeCloseTo(0.46, 9);
        expect(edgeSimPercentile(
            g([['a', 'b', 0.2], ['c', 'd', 0.4], ['e', 'f', 0.6], ['g', 'h', 0.8]]), 45,
        )).toBeCloseTo(0.47, 9);
    });

    it('p0 = 最小邊、p100 = 最大邊', () => {
        const graph = g([['a', 'b', 0.7], ['b', 'c', 0.8], ['c', 'd', 0.9]]);
        expect(edgeSimPercentile(graph, 0)).toBeCloseTo(0.7, 9);
        expect(edgeSimPercentile(graph, 100)).toBeCloseTo(0.9, 9);
    });

    it('每條邊只算一次（鄰接表雙向儲存不得重複計）', () => {
        // 兩條邊：0.2 / 0.8 → p50 = 0.5。若雙向重複計成四筆仍是 0.5，
        // 但三邊圖 [0.2, 0.8, 0.8] 的 p50 = 0.8 —— 用不對稱度數驗證去重。
        const graph = g([['a', 'b', 0.2], ['a', 'c', 0.8], ['a', 'd', 0.8]]);
        expect(edgeSimPercentile(graph, 50)).toBeCloseTo(0.8, 9);
    });

    it('無邊圖 → 0（門檻永不觸發）', () => {
        const graph: KnnGraph = new Map([['a', []], ['b', []]]);
        expect(edgeSimPercentile(graph, 45)).toBe(0);
    });
});

describe('NaN 防禦（紅隊 2026-07-20）', () => {
    it('buildKnnGraph：NaN 向量的筆記被整筆跳過，不進圖', () => {
        const bad = new Float32Array([NaN, 0]);
        const notes = [
            { path: 'a', vec: new Float32Array([1, 0]) },
            { path: 'b', vec: new Float32Array([0.9, 0.1]) },
            { path: 'x', vec: bad },
        ];
        const graph = buildKnnGraph(notes, 2);
        expect(graph.has('x')).toBe(false);
        for (const edges of graph.values()) {
            for (const e of edges) expect(Number.isFinite(e.sim)).toBe(true);
        }
    });

    it('widestPath：手建圖含 NaN 邊時，合法的 0.99 路徑不被毒殺', () => {
        // start→A→X 走 NaN、start→B→X 走 0.99：NaN 先寫入 dp 的話,
        // 0.99 > NaN 與 0.99 === NaN 都是 false → 正確候選被丟（毒殺場景）
        const graph = g([
            ['start', 'A', 0.9], ['A', 'X', NaN],
            ['start', 'B', 0.9], ['B', 'X', 0.99],
        ]);
        const r = widestPath(graph, 'start', 'X');
        expect(r).not.toBeNull();
        expect(r!.bottleneck).toBeCloseTo(0.9, 9);
        expect(r!.path).toEqual(['start', 'B', 'X']);
    });

    it('edgeSimPercentile：NaN 邊被過濾，門檻不會變 NaN', () => {
        const graph = g([['a', 'b', NaN], ['c', 'd', 0.8], ['e', 'f', 0.6]]);
        const p = edgeSimPercentile(graph, 50);
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeCloseTo(0.7, 9);
    });
});
