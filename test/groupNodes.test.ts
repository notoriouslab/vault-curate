import { describe, it, expect } from 'vitest';
import { addGroupNodes, GROUP_PAD } from '../src/canvas/groupNodes';
import type { CanvasJson } from '../src/canvas/graphCanvas';

const file = (id: string, path: string, x = 0, y = 0) =>
    ({ id, type: 'file' as const, file: path, x, y, width: 400, height: 360 });

describe('addGroupNodes（037 D2、D5）', () => {
    it('wraps a file node in a padded group placed right before it', () => {
        const canvas: CanvasJson = { nodes: [file('a-1', 'a.md')], edges: [] };
        const out = addGroupNodes(canvas, () => '神學');
        expect(out.nodes).toHaveLength(2);
        expect(out.nodes[0]).toEqual({
            id: 'g-a-1', type: 'group', label: '神學',
            x: -GROUP_PAD, y: -GROUP_PAD, width: 460, height: 420,
        });
        expect(out.nodes[1]).toBe(canvas.nodes[0]);
    });

    it('skips text nodes, null labels and nodes outside onlyNodeIds', () => {
        const canvas: CanvasJson = {
            nodes: [
                { id: 'q-0', type: 'text', text: 'q', x: 0, y: 0, width: 480, height: 420 },
                file('a-1', 'a.md', 800),
                file('b-2', 'b.md', -800),
                file('c-3', 'c.md', 0, 800),
            ],
            edges: [],
        };
        const out = addGroupNodes(canvas, (p) => (p === 'b.md' ? null : 'x'), new Set(['a-1', 'b-2']));
        expect(out.nodes.map((n) => n.id)).toEqual(['q-0', 'g-a-1', 'a-1', 'b-2', 'c-3']);
    });

    it('suffixes a group id that is already taken', () => {
        const canvas: CanvasJson = {
            nodes: [{ id: 'g-a-1', type: 'text', text: 'note', x: 2000, y: 0, width: 10, height: 10 }, file('a-1', 'a.md')],
            edges: [],
        };
        const out = addGroupNodes(canvas, () => 'x');
        expect(out.nodes.find((n) => n.type === 'group')!.id).toBe('g-a-1-2');
    });

    it('does not modify its input', () => {
        const canvas: CanvasJson = { nodes: [file('a-1', 'a.md')], edges: [{ id: 'e', fromNode: 'a-1', toNode: 'a-1' }] };
        const before = structuredClone(canvas);
        addGroupNodes(canvas, () => 'x');
        expect(canvas).toEqual(before);
    });
});
