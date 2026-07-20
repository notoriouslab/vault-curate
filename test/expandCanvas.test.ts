import { describe, it, expect } from 'vitest';
import { expandCanvas, CROWDED_NODE_COUNT } from '../src/canvas/expandCanvas';
import type { CanvasJson, GraphNeighborInput, ResolvedLinks } from '../src/canvas/graphCanvas';

const NO_LINKS: ResolvedLinks = {};

function fileNode(id: string, file: string, x = 0, y = 0, w = 400, h = 360, color?: string) {
    const n: CanvasJson['nodes'][number] = { id, type: 'file', file, x, y, width: w, height: h };
    if (color) n.color = color;
    return n;
}

/** 一張以 center.md 為中心、帶一個既有鄰居與一條既有邊的圖。 */
function baseCanvas(): CanvasJson {
    return {
        nodes: [
            fileNode('c0', 'center.md', -240, -210, 480, 420, '4'),
            fileNode('n1', 'old-neighbor.md', -200, -940),
        ],
        edges: [
            { id: 'e-n1', fromNode: 'c0', toNode: 'n1', fromSide: 'top', toSide: 'bottom', fromEnd: 'none', toEnd: 'none', label: '0.88' },
        ],
    };
}

const nb = (path: string, score = 0.8, tier: 'hot' | 'cold' = 'hot'): GraphNeighborInput =>
    ({ path, score, tier });

describe('expandCanvas（009 D5 主線）', () => {
    it('append-only：既有節點與邊全部欄位 deep-equal（含物件參照不變）', () => {
        const canvas = baseCanvas();
        const snapshot = JSON.parse(JSON.stringify(canvas)) as CanvasJson;
        const r = expandCanvas(canvas, 'center.md', [nb('a.md'), nb('b.md')], NO_LINKS);
        expect(r.canvas.nodes.slice(0, 2)).toEqual(snapshot.nodes);
        expect(r.canvas.edges.slice(0, 1)).toEqual(snapshot.edges);
        expect(r.canvas.nodes[0]).toBe(canvas.nodes[0]); // 參照重用，非複製後改動
        expect(r.added).toBe(2);
        expect(r.totalNodes).toBe(4);
    });

    it('節點去重：已在圖上的筆記不重加節點；已有邊也不重畫 → 回傳原物件', () => {
        const canvas = baseCanvas();
        const r = expandCanvas(canvas, 'center.md', [nb('old-neighbor.md'), nb('a.md')], NO_LINKS);
        expect(r.added).toBe(1);
        expect(r.canvas.nodes.map((n) => n.file)).toEqual(['center.md', 'old-neighbor.md', 'a.md']);
        expect(r.linkedExisting).toBe(0); // center↔old-neighbor 已有邊，不重畫

        const r2 = expandCanvas(canvas, 'center.md', [nb('old-neighbor.md'), nb('center.md')], NO_LINKS);
        expect(r2.added).toBe(0);
        expect(r2.linkedExisting).toBe(0);
        expect(r2.canvas).toBe(canvas); // 原物件，caller 據此跳過寫檔
    });

    it('有界補邊：鄰居已在圖上但無邊 → 補邊不補節點，含編碼與分數', () => {
        // b 節點在圖上但與 center 沒有邊
        const canvas = baseCanvas();
        canvas.nodes.push(fileNode('b1', 'b.md', 1200, 0));
        const links: ResolvedLinks = { 'center.md': { 'b.md': 1 } };
        const r = expandCanvas(canvas, 'center.md', [nb('b.md', 0.83)], links);
        expect(r.added).toBe(0);
        expect(r.linkedExisting).toBe(1);
        expect(r.canvas.nodes.length).toBe(3); // 不加節點
        const e = r.canvas.edges[r.canvas.edges.length - 1];
        expect(e.fromNode).toBe('c0');
        expect(e.toNode).toBe('b1');
        expect(e.label).toBe('0.83');
        expect(e.color).toBeUndefined(); // 已 wikilink → 灰
        expect(e.toEnd).toBe('arrow');
        // b1 在 center 正右方 → 邊從右側出、左側入
        expect(e.fromSide).toBe('right');
        expect(e.toSide).toBe('left');
        // 既有物件原樣
        expect(r.canvas.nodes[0]).toBe(canvas.nodes[0]);
        expect(r.canvas.edges[0]).toBe(canvas.edges[0]);
    });

    it('有界補邊 + 新節點混合：一次展開同時計數', () => {
        const canvas = baseCanvas();
        canvas.nodes.push(fileNode('b1', 'b.md', 1200, 0));
        const r = expandCanvas(canvas, 'center.md', [nb('b.md'), nb('new.md')], NO_LINKS);
        expect(r.added).toBe(1);
        expect(r.linkedExisting).toBe(1);
        expect(r.totalNodes).toBe(4);
        const backfill = r.canvas.edges.find((e) => e.toNode === 'b1')!;
        expect(backfill.color).toBe('6'); // 未 wikilink → 紫
    });

    it('有界補邊反向邊也算已連：b→center 已有邊則不補', () => {
        const canvas = baseCanvas();
        canvas.nodes.push(fileNode('b1', 'b.md', 1200, 0));
        canvas.edges.push({ id: 'e-rev', fromNode: 'b1', toNode: 'c0', fromEnd: 'none', toEnd: 'none' });
        const r = expandCanvas(canvas, 'center.md', [nb('b.md')], NO_LINKS);
        expect(r.linkedExisting).toBe(0);
        expect(r.added).toBe(0);
    });

    it('中心不在圖上 → throw（caller 轉 Notice）', () => {
        expect(() => expandCanvas(baseCanvas(), 'ghost.md', [nb('a.md')], NO_LINKS)).toThrow();
    });

    it('放射布局：單一新節點落在中心正上方 MIN_RADIUS 處', () => {
        const canvas: CanvasJson = { nodes: [fileNode('c0', 'center.md', -240, -210, 480, 420)], edges: [] };
        // 中心點 = (0, 0)
        const r = expandCanvas(canvas, 'center.md', [nb('a.md')], NO_LINKS);
        const added = r.canvas.nodes[1];
        expect(added.x).toBe(-200);       // 0 + 760·cos(-90°) − 400/2
        expect(added.y).toBe(-760 - 180); // 0 + 760·sin(-90°) − 360/2
        expect(r.collisionUnresolved).toBe(false);
    });

    it('逐點放置：12 點鐘被擋 → 同環順時針下一個空槽（不整圈外推）', () => {
        const canvas: CanvasJson = {
            nodes: [
                fileNode('c0', 'center.md', -240, -210, 480, 420),
                fileNode('blocker', 'blocker.md', -200, -940), // 恰在 760 環 12 點鐘位
            ],
            edges: [],
        };
        const r = expandCanvas(canvas, 'center.md', [nb('a.md')], NO_LINKS);
        const added = r.canvas.nodes[2];
        // 760 環 8 槽（45° 間距）：-90° 被擋，-45° 空 → round(760·cos45)=537
        expect(added.x).toBe(537 - 200);
        expect(added.y).toBe(-537 - 180);
        expect(r.collisionUnresolved).toBe(false);
    });

    it('全部槽位被占 → 停最外環照放 + collisionUnresolved', () => {
        // 巨型節點蓋滿所有環帶
        const canvas: CanvasJson = {
            nodes: [
                fileNode('c0', 'center.md', -240, -210, 480, 420),
                fileNode('wall', 'wall.md', -6000, -6000, 12000, 12000),
            ],
            edges: [],
        };
        const r = expandCanvas(canvas, 'center.md', [nb('a.md')], NO_LINKS);
        expect(r.added).toBe(1);
        expect(r.collisionUnresolved).toBe(true);
        expect(r.canvas.nodes[2].y).toBe(-(760 + 7 * 200) - 180); // 最外環 12 點鐘
    });

    it('逐點放置：多節點彼此也避讓（同環相鄰槽，不重疊）', () => {
        const canvas: CanvasJson = { nodes: [fileNode('c0', 'center.md', -240, -210, 480, 420)], edges: [] };
        const r = expandCanvas(canvas, 'center.md', [nb('a.md'), nb('b.md'), nb('c.md')], NO_LINKS);
        const added = r.canvas.nodes.slice(1);
        // 兩兩不重疊（margin 0 的硬重疊檢查）
        for (let i = 0; i < added.length; i++) {
            for (let j = i + 1; j < added.length; j++) {
                const a = added[i], b = added[j];
                const apart = a.x + a.width <= b.x || b.x + b.width <= a.x
                    || a.y + a.height <= b.y || b.y + b.height <= a.y;
                expect(apart).toBe(true);
            }
        }
        expect(added[0].y).toBe(-940); // 首槽仍是 12 點鐘（讀取順序 = 分數順序）
    });

    it('視覺編碼沿 006：cold 上青色、未連結紫邊、已連結箭頭', () => {
        const links: ResolvedLinks = { 'center.md': { 'a.md': 1 } };
        const r = expandCanvas(
            baseCanvas(), 'center.md',
            [nb('a.md', 0.9), nb('b.md', 0.7, 'cold')],
            links,
        );
        const [na, nbNode] = r.canvas.nodes.slice(2);
        expect(na.color).toBeUndefined();
        expect(nbNode.color).toBe('5');
        const [ea, eb] = r.canvas.edges.slice(1);
        expect(ea.color).toBeUndefined();  // 已連結
        expect(ea.toEnd).toBe('arrow');
        expect(ea.label).toBe('0.90');
        expect(eb.color).toBe('6');        // 未連結
        expect(eb.fromEnd).toBe('none');
        expect(eb.label).toBe('0.70');
        expect(ea.fromNode).toBe('c0');
    });

    it('id 唯一性：既有 id 撞名時新 id 加序號', () => {
        const canvas = baseCanvas();
        const r1 = expandCanvas(canvas, 'center.md', [nb('a.md')], NO_LINKS);
        const takenId = r1.canvas.nodes[2].id;
        // 把「上一次展開的產物」直接放進圖裡但換個 path，模擬 hash/序號撞名
        const canvas2 = baseCanvas();
        canvas2.nodes.push({ ...r1.canvas.nodes[2], file: 'other.md' });
        const r2 = expandCanvas(canvas2, 'center.md', [nb('a.md')], NO_LINKS);
        const newId = r2.canvas.nodes[3].id;
        expect(newId).not.toBe(takenId);
        expect(new Set(r2.canvas.nodes.map((n) => n.id)).size).toBe(r2.canvas.nodes.length);
    });

    it('連續展開兩次（重讀最新結果）→ 第二次仍去重、id 全域唯一', () => {
        const first = expandCanvas(baseCanvas(), 'center.md', [nb('a.md'), nb('b.md')], NO_LINKS);
        const second = expandCanvas(first.canvas, 'a.md' , [nb('b.md'), nb('c.md'), nb('center.md')], NO_LINKS);
        expect(second.added).toBe(1); // b/center 已在圖上，只加 c
        const ids = second.canvas.nodes.map((n) => n.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(second.canvas.nodes.map((n) => n.file))
            .toEqual(['center.md', 'old-neighbor.md', 'a.md', 'b.md', 'c.md']);
    });

    it('全滿照放（>12 顆）：停車螺旋外推，座標不重複（紅隊）', () => {
        const canvas: CanvasJson = {
            nodes: [
                fileNode('c0', 'center.md', -240, -210, 480, 420),
                fileNode('wall', 'wall.md', -6000, -6000, 12000, 12000),
            ],
            edges: [],
        };
        const many = Array.from({ length: 20 }, (_, i) => nb(`n${i}.md`));
        const r = expandCanvas(canvas, 'center.md', many, NO_LINKS);
        expect(r.collisionUnresolved).toBe(true);
        const coords = r.canvas.nodes.slice(2).map((n) => `${n.x},${n.y}`);
        expect(new Set(coords).size).toBe(20); // 無任何兩顆完全同座標
    });

    it('混合節點型別：text 便利貼被指 ≥2 也不上 hub 色（稽核）', () => {
        const canvas = baseCanvas();
        // 手動加一個 text 節點（真實 canvas 常見），被兩條邊指到
        canvas.nodes.push({ id: 'memo', type: 'text', x: 900, y: 900, width: 200, height: 100 } as never);
        canvas.edges.push(
            { id: 'e-m1', fromNode: 'c0', toNode: 'memo', fromEnd: 'none', toEnd: 'none' },
            { id: 'e-m2', fromNode: 'n1', toNode: 'memo', fromEnd: 'none', toEnd: 'none' },
        );
        const r = expandCanvas(canvas, 'center.md', [nb('a.md')], NO_LINKS);
        const memo = r.canvas.nodes.find((n) => n.id === 'memo')!;
        expect((memo as { color?: string }).color).toBeUndefined();
    });

    it('負數 width/height 的既有節點：障礙箱正規化，不翻轉碰撞語意（紅隊）', () => {
        const canvas: CanvasJson = {
            nodes: [
                fileNode('c0', 'center.md', -240, -210, 480, 420),
                // 手改出來的負寬節點，實際占據 [-600,-200]x[-940,-580]（12 點鐘偏左）
                fileNode('weird', 'weird.md', -200, -580, -400, -360),
            ],
            edges: [],
        };
        const r = expandCanvas(canvas, 'center.md', [nb('a.md')], NO_LINKS);
        const added = r.canvas.nodes[2];
        // 12 點鐘槽 [-200,200]x[-940,-580] 與 weird 實占區重疊（x 間隙 0 < margin）
        // → 必須跳下一槽，不得因負寬把 weird 誤判為「空」
        expect(`${added.x},${added.y}`).not.toBe('-200,-940');
    });

    it('CROWDED_NODE_COUNT 常數 = 60（design D5）', () => {
        expect(CROWDED_NODE_COUNT).toBe(60);
    });
});

describe('匯聚 hub 橙色（主公 2026-07-20 裁決）', () => {
    /** c0(center.md) → n1、c0 → b1 已有邊；從 n1 展開命中 b.md → 補邊
     *  n1→b1 → b1 被指 2 次成 hub。 */
    function hubScenario(b1Color?: string) {
        const canvas = baseCanvas();
        canvas.nodes.push(fileNode('b1', 'b.md', 1200, 0, 400, 360, b1Color));
        canvas.edges.push({ id: 'e-b1', fromNode: 'c0', toNode: 'b1', fromEnd: 'none', toEnd: 'none', label: '0.80' });
        return canvas;
    }

    it('被指 ≥2 → 節點框 + 兩條指向邊全變橙 "2"；未涉及物件參照不變', () => {
        const canvas = hubScenario();
        const r = expandCanvas(canvas, 'old-neighbor.md', [nb('b.md', 0.82)], NO_LINKS);
        expect(r.linkedExisting).toBe(1);
        const b1 = r.canvas.nodes.find((n) => n.id === 'b1')!;
        expect(b1.color).toBe('2');
        expect(b1).not.toBe(canvas.nodes[2]); // clone，原物件不動
        expect(canvas.nodes[2].color).toBeUndefined();
        const incoming = r.canvas.edges.filter((e) => e.toNode === 'b1');
        expect(incoming.length).toBe(2);
        for (const e of incoming) expect(e.color).toBe('2');
        // 非 hub 的節點與邊參照原樣
        expect(r.canvas.nodes[0]).toBe(canvas.nodes[0]);
        expect(r.canvas.edges[0]).toBe(canvas.edges[0]); // c0→n1（n1 被指 1 次）
    });

    it('使用者手動色（紅 "1"）與中心綠 "4" 受保護，不上 hub 色', () => {
        for (const protectedColor of ['1', '4']) {
            const canvas = hubScenario(protectedColor);
            const r = expandCanvas(canvas, 'old-neighbor.md', [nb('b.md')], NO_LINKS);
            const b1 = r.canvas.nodes.find((n) => n.id === 'b1')!;
            expect(b1.color).toBe(protectedColor);
            for (const e of r.canvas.edges.filter((x) => x.toNode === 'b1')) {
                expect(e.color).not.toBe('2');
            }
        }
    });

    it('cold 青 "5" 是我們的色 → hub 覆蓋為橙', () => {
        const canvas = hubScenario('5');
        const r = expandCanvas(canvas, 'old-neighbor.md', [nb('b.md')], NO_LINKS);
        expect(r.canvas.nodes.find((n) => n.id === 'b1')!.color).toBe('2');
    });

    it('被指 1 次不觸發：一般展開不產生 hub', () => {
        const r = expandCanvas(baseCanvas(), 'center.md', [nb('a.md'), nb('b.md')], NO_LINKS);
        for (const n of r.canvas.nodes) expect(n.color === '2').toBe(false);
    });
});
