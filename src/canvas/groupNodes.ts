// Canvas group frames (037) — pure, no Obsidian imports.
//
// Each file node gets a group frame padded by GROUP_PAD whose label names the
// note (groupLabel.ts). Applied after a builder or an expansion has laid the
// cards out, so the builders themselves stay unchanged.

import type { CanvasGroupNode, CanvasJson } from "./graphCanvas";
import { uniqueId } from "./expandCanvas";

export const GROUP_PAD = 30;

/** Wrap file nodes (only those in `onlyNodeIds`, when given) in a labelled
 *  group; `labelFor` returning null leaves that card alone. JSON Canvas draws
 *  nodes in array order, so each group goes right before its card. Returns a
 *  new canvas; the input is not modified. */
export function addGroupNodes(
    canvas: CanvasJson,
    labelFor: (path: string) => string | null,
    onlyNodeIds?: ReadonlySet<string>,
): CanvasJson {
    const taken = new Set(canvas.nodes.map((n) => n.id));
    const nodes: CanvasJson["nodes"] = [];
    for (const n of canvas.nodes) {
        if (n.type === "file" && (!onlyNodeIds || onlyNodeIds.has(n.id))) {
            const label = labelFor(n.file);
            if (label !== null) {
                const group: CanvasGroupNode = {
                    id: uniqueId(`g-${n.id}`, taken),
                    type: "group",
                    label,
                    x: n.x - GROUP_PAD,
                    y: n.y - GROUP_PAD,
                    width: n.width + 2 * GROUP_PAD,
                    height: n.height + 2 * GROUP_PAD,
                };
                nodes.push(group);
            }
        }
        nodes.push(n);
    }
    return { nodes, edges: canvas.edges };
}
