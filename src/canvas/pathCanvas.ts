// Semantic Path Canvas (009 D3) — pure builder, no Obsidian imports.
//
// Lays a widest-path chain (semanticPath.ts) out as a single horizontal
// row of file nodes: x = i × (NODE_W + 200), y = 0, no wrapping (max 6
// hops = at most 7 nodes; Canvas pans). Visual encoding follows 006
// (graphCanvas.ts): endpoints green COLOR_CENTER, intermediate nodes
// tier-colored (cold = cyan), edges labeled with the hop similarity and
// colored purple when the two notes are not yet wiki-linked.

import {
    classifyEdge,
    djb2Hex,
    NODE_W,
    NODE_H,
    COLOR_CENTER,
    COLOR_COLD,
    COLOR_UNLINKED,
    type CanvasEdge,
    type CanvasFileNode,
    type CanvasJson,
    type GraphNodeInput,
    type ResolvedLinks,
} from "./graphCanvas";

const GAP_X = 200;

/**
 * Build the linear chain canvas. `chain` is the full path from start to
 * end (inclusive, ≥ 2 nodes); `sims[i]` is the similarity of the edge
 * chain[i] → chain[i+1] (length = chain.length - 1).
 */
export function buildPathCanvas(
    chain: GraphNodeInput[],
    sims: number[],
    links: ResolvedLinks,
): CanvasJson {
    if (chain.length < 2) {
        throw new Error("buildPathCanvas: chain must have at least 2 nodes (caller guards A=E)");
    }
    if (sims.length !== chain.length - 1) {
        throw new Error("buildPathCanvas: sims length must be chain length - 1");
    }

    const nodes: CanvasFileNode[] = chain.map((n, i) => {
        const node: CanvasFileNode = {
            id: `${djb2Hex(n.path)}-${i}`,
            type: "file",
            file: n.path,
            x: i * (NODE_W + GAP_X),
            y: 0,
            width: NODE_W,
            height: NODE_H,
        };
        const isEndpoint = i === 0 || i === chain.length - 1;
        if (isEndpoint) node.color = COLOR_CENTER;
        else if (n.tier === "cold") node.color = COLOR_COLD;
        return node;
    });

    const edges: CanvasEdge[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
        const { linked, direction } = classifyEdge(chain[i].path, chain[i + 1].path, links);
        const edge: CanvasEdge = {
            id: `e-${nodes[i + 1].id}`,
            fromNode: nodes[i].id,
            toNode: nodes[i + 1].id,
            fromSide: "right",
            toSide: "left",
            fromEnd: linked && (direction === "in" || direction === "both") ? "arrow" : "none",
            toEnd: linked && (direction === "out" || direction === "both") ? "arrow" : "none",
            label: sims[i].toFixed(2),
        };
        if (!linked) edge.color = COLOR_UNLINKED;
        edges.push(edge);
    }

    return { nodes, edges };
}

/** `{prefix}-{from}-{to}-{stamp}.canvas`, deduplicated against existing
 *  names with a `-2`, `-3`, … suffix (same pattern as 006). */
export function pathCanvasFileName(
    prefix: string,
    fromBasename: string,
    toBasename: string,
    stamp: string,
    existingNames: Set<string>,
): string {
    const base = `${prefix}-${fromBasename}-${toBasename}-${stamp}`;
    let name = `${base}.canvas`;
    for (let n = 2; existingNames.has(name); n++) {
        name = `${base}-${n}.canvas`;
    }
    return name;
}
