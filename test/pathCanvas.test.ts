import { describe, it, expect } from 'vitest';
import { buildPathCanvas, pathCanvasFileName } from '../src/canvas/pathCanvas';
import type { GraphNodeInput, ResolvedLinks } from '../src/canvas/graphCanvas';

const node = (path: string, tier: 'hot' | 'cold' = 'hot'): GraphNodeInput => ({ path, tier });

const CHAIN5 = [node('a.md'), node('b.md', 'cold'), node('c.md'), node('d.md', 'cold'), node('e.md')];
const SIMS4 = [0.91, 0.72, 0.84, 0.6];
const NO_LINKS: ResolvedLinks = {};

describe('buildPathCanvas', () => {
    it('throws on chain shorter than 2 nodes', () => {
        expect(() => buildPathCanvas([node('a.md')], [], NO_LINKS)).toThrow();
        expect(() => buildPathCanvas([], [], NO_LINKS)).toThrow();
    });

    it('throws when sims length does not match chain length - 1', () => {
        expect(() => buildPathCanvas(CHAIN5, [0.9, 0.8], NO_LINKS)).toThrow();
    });

    it('layout: x strictly increasing, y constant 0 (design D3)', () => {
        const { nodes } = buildPathCanvas(CHAIN5, SIMS4, NO_LINKS);
        for (let i = 1; i < nodes.length; i++) {
            expect(nodes[i].x).toBeGreaterThan(nodes[i - 1].x);
        }
        for (const n of nodes) expect(n.y).toBe(0);
        // Exact spec: x = i × (400 + 200)
        expect(nodes.map((n) => n.x)).toEqual([0, 600, 1200, 1800, 2400]);
    });

    it('edge count = node count - 1, each edge links consecutive nodes left→right', () => {
        const { nodes, edges } = buildPathCanvas(CHAIN5, SIMS4, NO_LINKS);
        expect(edges.length).toBe(nodes.length - 1);
        for (let i = 0; i < edges.length; i++) {
            expect(edges[i].fromNode).toBe(nodes[i].id);
            expect(edges[i].toNode).toBe(nodes[i + 1].id);
            expect(edges[i].fromSide).toBe('right');
            expect(edges[i].toSide).toBe('left');
        }
    });

    it('endpoints green "4"; intermediates tier-colored (cold "5", hot uncolored)', () => {
        const { nodes } = buildPathCanvas(CHAIN5, SIMS4, NO_LINKS);
        expect(nodes[0].color).toBe('4');
        expect(nodes[4].color).toBe('4');
        expect(nodes[1].color).toBe('5'); // cold intermediate
        expect(nodes[2].color).toBeUndefined(); // hot intermediate
        expect(nodes[3].color).toBe('5');
    });

    it('endpoint color wins over cold tier', () => {
        const { nodes } = buildPathCanvas(
            [node('a.md', 'cold'), node('b.md'), node('c.md', 'cold')],
            [0.8, 0.7],
            NO_LINKS,
        );
        expect(nodes[0].color).toBe('4');
        expect(nodes[2].color).toBe('4');
    });

    it('edge labels carry hop similarity formatted to 2 decimals', () => {
        const { edges } = buildPathCanvas(CHAIN5, SIMS4, NO_LINKS);
        expect(edges.map((e) => e.label)).toEqual(['0.91', '0.72', '0.84', '0.60']);
    });

    it('unlinked hops purple "6"; linked hops uncolored with direction arrows (006 encoding)', () => {
        const links: ResolvedLinks = { 'a.md': { 'b.md': 1 }, 'c.md': { 'b.md': 2 } };
        const { edges } = buildPathCanvas(
            [node('a.md'), node('b.md'), node('c.md')],
            [0.9, 0.8],
            links,
        );
        // a→b linked out: no color, arrow at destination end
        expect(edges[0].color).toBeUndefined();
        expect(edges[0].toEnd).toBe('arrow');
        expect(edges[0].fromEnd).toBe('none');
        // b←c linked in (c links to b): arrow at origin end
        expect(edges[1].color).toBeUndefined();
        expect(edges[1].fromEnd).toBe('arrow');
        expect(edges[1].toEnd).toBe('none');
    });

    it('unlinked edges have no arrows and purple color', () => {
        const { edges } = buildPathCanvas(CHAIN5, SIMS4, NO_LINKS);
        for (const e of edges) {
            expect(e.color).toBe('6');
            expect(e.fromEnd).toBe('none');
            expect(e.toEnd).toBe('none');
        }
    });

    it('JSON Canvas schema: file nodes with required fields, unique ids, edges reference real nodes', () => {
        const { nodes, edges } = buildPathCanvas(CHAIN5, SIMS4, NO_LINKS);
        const ids = new Set(nodes.map((n) => n.id));
        expect(ids.size).toBe(nodes.length);
        for (const n of nodes) {
            expect(n.type).toBe('file');
            expect(typeof n.file).toBe('string');
            expect(typeof n.width).toBe('number');
            expect(typeof n.height).toBe('number');
        }
        const edgeIds = new Set(edges.map((e) => e.id));
        expect(edgeIds.size).toBe(edges.length);
        for (const e of edges) {
            expect(ids.has(e.fromNode)).toBe(true);
            expect(ids.has(e.toNode)).toBe(true);
        }
    });

    it('duplicate note appearing at different positions still yields unique node ids', () => {
        // widestPath cannot revisit a node within one optimal chain, but the
        // builder should not silently rely on that.
        const { nodes } = buildPathCanvas(
            [node('a.md'), node('b.md'), node('a.md')],
            [0.9, 0.9],
            NO_LINKS,
        );
        expect(new Set(nodes.map((n) => n.id)).size).toBe(3);
    });

    it('direct connection (2-node chain) renders one edge, both endpoints green', () => {
        const { nodes, edges } = buildPathCanvas([node('a.md'), node('b.md')], [0.95], NO_LINKS);
        expect(nodes.length).toBe(2);
        expect(edges.length).toBe(1);
        expect(nodes[0].color).toBe('4');
        expect(nodes[1].color).toBe('4');
        expect(edges[0].label).toBe('0.95');
    });
});

describe('pathCanvasFileName', () => {
    it('formats {prefix}-{from}-{to}-{stamp}.canvas', () => {
        expect(pathCanvasFileName('語意路徑', 'A', 'B', '20260719-120000', new Set()))
            .toBe('語意路徑-A-B-20260719-120000.canvas');
    });

    it('deduplicates against existing names with -2, -3 suffixes', () => {
        const existing = new Set([
            '語意路徑-A-B-20260719-120000.canvas',
            '語意路徑-A-B-20260719-120000-2.canvas',
        ]);
        expect(pathCanvasFileName('語意路徑', 'A', 'B', '20260719-120000', existing))
            .toBe('語意路徑-A-B-20260719-120000-3.canvas');
    });
});
