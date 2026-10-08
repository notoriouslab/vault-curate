import { describe, it, expect } from 'vitest';
import {
    classifyEdge,
    layoutRadial,
    buildGraphCanvas,
    graphCanvasFileName,
    type ResolvedLinks,
} from '../src/canvas/graphCanvas';

describe('classifyEdge', () => {
    it('A→B only → linked, direction out', () => {
        const links: ResolvedLinks = { 'a.md': { 'b.md': 1 } };
        expect(classifyEdge('a.md', 'b.md', links)).toEqual({ linked: true, direction: 'out' });
    });

    it('B→A only → linked, direction in', () => {
        const links: ResolvedLinks = { 'b.md': { 'a.md': 3 } };
        expect(classifyEdge('a.md', 'b.md', links)).toEqual({ linked: true, direction: 'in' });
    });

    it('both directions → linked, direction both', () => {
        const links: ResolvedLinks = { 'a.md': { 'b.md': 1 }, 'b.md': { 'a.md': 1 } };
        expect(classifyEdge('a.md', 'b.md', links)).toEqual({ linked: true, direction: 'both' });
    });

    it('no link either way → not linked, direction null', () => {
        const links: ResolvedLinks = { 'a.md': { 'x.md': 1 } };
        expect(classifyEdge('a.md', 'b.md', links)).toEqual({ linked: false, direction: null });
    });
});

describe('layoutRadial', () => {
    it('K=1: single neighbor at 12 o\'clock, MIN_RADIUS', () => {
        const { radius, positions, sides } = layoutRadial(1);
        expect(radius).toBe(760);
        expect(positions).toEqual([{ x: -200, y: -940 }]);
        expect(sides).toEqual([{ fromSide: 'top', toSide: 'bottom' }]);
    });

    it('K=4: four quadrants, correct coordinates and sides', () => {
        const { radius, positions, sides } = layoutRadial(4);
        expect(radius).toBe(760);
        expect(positions).toEqual([
            { x: -200, y: -940 },  // -90° top
            { x: 560, y: -180 },   //   0° right
            { x: -200, y: 580 },   //  90° bottom
            { x: -960, y: -180 },  // 180° left
        ]);
        expect(sides).toEqual([
            { fromSide: 'top', toSide: 'bottom' },
            { fromSide: 'right', toSide: 'left' },
            { fromSide: 'bottom', toSide: 'top' },
            { fromSide: 'left', toSide: 'right' },
        ]);
    });

    it('K=12: radius grows via chord formula and no adjacent bounding boxes overlap', () => {
        const { radius, positions } = layoutRadial(12);
        expect(radius).toBe(1218); // ceil(630 / (2 * sin(PI/12)))  (037: was 540 → 1044)
        const W = 400;
        const H = 360;
        for (let i = 0; i < 12; i++) {
            const a = positions[i];
            const b = positions[(i + 1) % 12];
            const dx = Math.abs((a.x + W / 2) - (b.x + W / 2));
            const dy = Math.abs((a.y + H / 2) - (b.y + H / 2));
            const overlaps = dx < W && dy < H;
            expect(overlaps, `adjacent pair ${i}/${(i + 1) % 12} overlaps (dx=${dx}, dy=${dy})`).toBe(false);
        }
    });
    it('037: group frames (pad 30) never overlap each other or the centre frame, k = 1…12', () => {
        const P = 30;
        type Box = { x: number; y: number; w: number; h: number };
        const overlap = (a: Box, b: Box) =>
            !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
        const centre: Box = { x: -240 - P, y: -210 - P, w: 480 + 2 * P, h: 420 + 2 * P };
        for (let k = 1; k <= 12; k++) {
            const frames = layoutRadial(k).positions.map((p) => ({ x: p.x - P, y: p.y - P, w: 400 + 2 * P, h: 360 + 2 * P }));
            for (let i = 0; i < k; i++) {
                expect(overlap(frames[i], centre), `k=${k} frame ${i} overlaps centre`).toBe(false);
                for (let j = i + 1; j < k; j++) {
                    expect(overlap(frames[i], frames[j]), `k=${k} frames ${i}/${j} overlap`).toBe(false);
                }
            }
        }
    });
});

describe('buildGraphCanvas', () => {
    const center = { path: 'center.md', tier: 'hot' as const };
    const neighbors = [
        { path: 'linked-out.md', tier: 'hot' as const, score: 0.91 },
        { path: 'linked-in.md', tier: 'hot' as const, score: 0.85 },
        { path: 'cold-unlinked.md', tier: 'cold' as const, score: 0.72 },
    ];
    const links: ResolvedLinks = {
        'center.md': { 'linked-out.md': 1 },
        'linked-in.md': { 'center.md': 2 },
    };

    it('center node: file type, 480×420 at (-240,-210), color "4"; cold neighbor "5"; hot neighbor no color', () => {
        const canvas = buildGraphCanvas(center, neighbors, links);
        expect(canvas.nodes).toHaveLength(4);
        const centerNode = canvas.nodes[0];
        expect(centerNode.type).toBe('file');
        expect(centerNode.file).toBe('center.md');
        expect(centerNode.x).toBe(-240);
        expect(centerNode.y).toBe(-210);
        expect(centerNode.width).toBe(480);
        expect(centerNode.height).toBe(420);
        expect(centerNode.color).toBe('4');
        const hotNode = canvas.nodes[1];
        expect(hotNode.width).toBe(400);
        expect(hotNode.height).toBe(360);
        expect(hotNode.color).toBeUndefined();
        const coldNode = canvas.nodes[3];
        expect(coldNode.file).toBe('cold-unlinked.md');
        expect(coldNode.color).toBe('5');
    });

    it('edges: linked = default color + direction arrows; unlinked = purple + no arrows; all carry score label', () => {
        const canvas = buildGraphCanvas(center, neighbors, links);
        expect(canvas.edges).toHaveLength(3);
        const [outEdge, inEdge, semanticEdge] = canvas.edges;

        expect(outEdge.color).toBeUndefined();
        expect(outEdge.label).toBe('0.91');
        expect(outEdge.fromEnd).toBe('none');
        expect(outEdge.toEnd).toBe('arrow');

        expect(inEdge.color).toBeUndefined();
        expect(inEdge.label).toBe('0.85');
        expect(inEdge.fromEnd).toBe('arrow');
        expect(inEdge.toEnd).toBe('none');

        expect(semanticEdge.color).toBe('6');
        expect(semanticEdge.label).toBe('0.72');
        expect(semanticEdge.fromEnd).toBe('none');
        expect(semanticEdge.toEnd).toBe('none');
    });

    it('edges wire center to each neighbor with layout sides, and ids are deterministic', () => {
        const canvas = buildGraphCanvas(center, neighbors, links);
        const centerId = canvas.nodes[0].id;
        for (let i = 0; i < canvas.edges.length; i++) {
            expect(canvas.edges[i].fromNode).toBe(centerId);
            expect(canvas.edges[i].toNode).toBe(canvas.nodes[i + 1].id);
        }
        // K=3: angles -90°, 30°, 150° → top, bottom-right sector, bottom-left sector
        expect(canvas.edges[0].fromSide).toBe('top');
        const again = buildGraphCanvas(center, neighbors, links);
        expect(again).toEqual(canvas);
    });

    it('throws on empty neighbors (caller must guard zero results)', () => {
        expect(() => buildGraphCanvas(center, [], links)).toThrow();
    });
});

describe('graphCanvasFileName', () => {
    it('no collision → plain stamped name', () => {
        expect(graphCanvasFileName('note', '20260707-120000', new Set())).toBe(
            'note · graph · 20260707-120000.canvas',
        );
    });

    it('collision → -2 suffix; -2 taken → -3', () => {
        const taken = new Set(['note · graph · 20260707-120000.canvas']);
        expect(graphCanvasFileName('note', '20260707-120000', taken)).toBe(
            'note · graph · 20260707-120000-2.canvas',
        );
        taken.add('note · graph · 20260707-120000-2.canvas');
        expect(graphCanvasFileName('note', '20260707-120000', taken)).toBe(
            'note · graph · 20260707-120000-3.canvas',
        );
    });
});
