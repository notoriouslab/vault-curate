// In-place canvas expansion (009 D5 mainline) — pure builder, no Obsidian
// imports.
//
// Appends a clicked node's semantic neighborhood to an EXISTING canvas.
// Placement is slot-based (2026-07-20 dogfood amendment): candidate slots
// live on rings around the clicked node (radius from 006's MIN_RADIUS,
// +200 per ring, slots spaced ≥ CHORD_MIN of arc); each new node takes
// the innermost free slot scanning clockwise from 12 o'clock, avoiding
// existing nodes AND the nodes placed before it — an all-or-nothing ring
// collapses into "照放" on any crowded canvas, per-node slots don't.
//
// Existing objects are reused untouched, with ONE deliberate exception:
// a node whose incoming-edge count reaches HUB_DEGREE is re-colored
// orange (frame + incoming edges) as a convergence marker — and only
// when the current color is ours or absent, so a user's manual color is
// never overwritten. The spike showed Obsidian rewrites byte format on
// save, so structural JSON equality is the invariant, never byte-level.

import {
    classifyEdge,
    djb2Hex,
    sideForAngle,
    CHORD_MIN,
    MIN_RADIUS,
    NODE_W,
    NODE_H,
    COLOR_COLD,
    COLOR_UNLINKED,
    type CanvasEdge,
    type CanvasFileNode,
    type CanvasJson,
    type GraphNeighborInput,
    type ResolvedLinks,
} from "./graphCanvas";

const COLLISION_MARGIN = 100;
const RADIUS_STEP = 200;
const MAX_RINGS = 8;
/** Post-expansion node count above which the caller warns the graph is
 *  getting crowded (design D5). */
export const CROWDED_NODE_COUNT = 60;
/** A node pointed at by this many edges (toNode side) is a convergence
 *  hub: several expansions/chains independently landed on it. */
export const HUB_DEGREE = 2;
/** Orange — convergence hub marker (主公 2026-07-20). */
export const COLOR_HUB = "2";
/** Node colors we own and may overwrite with the hub marker. User-set
 *  colors (red/yellow/…) and the center/endpoint green stay untouched. */
const MUTABLE_NODE_COLORS = new Set([undefined, COLOR_COLD, COLOR_HUB]);
const MUTABLE_EDGE_COLORS = new Set([undefined, COLOR_UNLINKED, COLOR_HUB]);

export interface ExpandResult {
    /** New canvas object; pre-existing node/edge objects are the same
     *  references, unmodified. When nothing changed this IS the input. */
    canvas: CanvasJson;
    added: number;
    /** Bounded backfill: neighbors ALREADY on the canvas get a new edge
     *  from the clicked node (never a duplicate node) — relations that a
     *  plain node-dedupe would silently drop. Nodes reached by several
     *  expansions accumulate edges and read as hubs. */
    linkedExisting: number;
    totalNodes: number;
    /** True when even the widest ring (5 retries) still collided — the
     *  ring was placed anyway and the caller should notify. */
    collisionUnresolved: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

function overlaps(a: Box, b: Box, margin: number): boolean {
    return !(
        a.x + a.w + margin <= b.x ||
        b.x + b.w + margin <= a.x ||
        a.y + a.h + margin <= b.y ||
        b.y + b.h + margin <= a.y
    );
}

interface Slot { x: number; y: number; angleDeg: number }

function slotAt(cx: number, cy: number, radius: number, angleDeg: number): Slot {
    const angleRad = (angleDeg * Math.PI) / 180;
    return {
        x: Math.round(cx + radius * Math.cos(angleRad)) - NODE_W / 2,
        y: Math.round(cy + radius * Math.sin(angleRad)) - NODE_H / 2,
        angleDeg,
    };
}

/** Innermost free slot: rings inside-out, angles clockwise from 12
 *  o'clock, slots spaced ≥ CHORD_MIN of arc so same-ring neighbours can
 *  never overlap. Returns null when every slot on every ring is taken. */
function findFreeSlot(cx: number, cy: number, obstacles: Box[]): Slot | null {
    for (let ring = 0; ring < MAX_RINGS; ring++) {
        const radius = MIN_RADIUS + ring * RADIUS_STEP;
        const slots = Math.max(4, Math.floor((2 * Math.PI * radius) / CHORD_MIN));
        for (let i = 0; i < slots; i++) {
            const slot = slotAt(cx, cy, radius, -90 + i * (360 / slots));
            const box = { x: slot.x, y: slot.y, w: NODE_W, h: NODE_H };
            if (!obstacles.some((o) => overlaps(box, o, COLLISION_MARGIN))) return slot;
        }
    }
    return null;
}

function uniqueId(candidate: string, taken: Set<string>): string {
    let id = candidate;
    for (let n = 2; taken.has(id); n++) id = `${candidate}-${n}`;
    taken.add(id);
    return id;
}

/**
 * Append `neighbors` of `centerPath` (pre-sorted by score descending,
 * already thresholded by the caller) to `canvas`. Neighbors whose note is
 * already on the canvas are skipped (dedupe by file path). Throws when
 * `centerPath` has no file node on the canvas — the caller re-reads the
 * live file, so this only happens if the canvas changed underneath the
 * menu click.
 */
export function expandCanvas(
    canvas: CanvasJson,
    centerPath: string,
    neighbors: GraphNeighborInput[],
    links: ResolvedLinks,
): ExpandResult {
    const center = canvas.nodes.find((n) => n.type === "file" && n.file === centerPath);
    if (!center) {
        throw new Error(`expandCanvas: "${centerPath}" has no node on this canvas`);
    }

    const fileNodes = canvas.nodes.filter((n) => n.type === "file");
    const existingPaths = new Set(fileNodes.map((n) => n.file));
    const fresh = neighbors.filter((n) => !existingPaths.has(n.path));

    // Bounded backfill: neighbors already on the canvas whose relation to
    // the clicked node isn't drawn yet. Deduped at FILE-pair level so a
    // note that appears twice never collects a second semantic edge.
    const idToFile = new Map(fileNodes.map((n) => [n.id, n.file]));
    const connectedPairs = new Set<string>();
    for (const e of canvas.edges) {
        const a = idToFile.get(e.fromNode);
        const b = idToFile.get(e.toNode);
        if (a !== undefined && b !== undefined) {
            connectedPairs.add(a < b ? `${a}\n${b}` : `${b}\n${a}`);
        }
    }
    const toLink = neighbors.filter((n) => {
        if (!existingPaths.has(n.path) || n.path === centerPath) return false;
        const key = centerPath < n.path ? `${centerPath}\n${n.path}` : `${n.path}\n${centerPath}`;
        return !connectedPairs.has(key);
    });

    if (fresh.length === 0 && toLink.length === 0) {
        return {
            canvas, added: 0, linkedExisting: 0,
            totalNodes: canvas.nodes.length, collisionUnresolved: false,
        };
    }

    const cx = center.x + center.width / 2;
    const cy = center.y + center.height / 2;
    // Obstacles grow as nodes are placed — new nodes avoid each other too.
    // Boxes are normalized (hand-edited canvases can carry negative
    // width/height, which would flip the overlap test's semantics).
    const obstacles: Box[] = canvas.nodes.map((n) => ({
        x: Math.min(n.x, n.x + n.width),
        y: Math.min(n.y, n.y + n.height),
        w: Math.abs(n.width),
        h: Math.abs(n.height),
    }));

    const placed: Slot[] = [];
    let collisionUnresolved = false;
    for (let i = 0; i < fresh.length; i++) {
        let slot = findFreeSlot(cx, cy, obstacles);
        if (!slot) {
            // Every slot taken: park beyond the outermost ring and say so.
            // The parking spiral keeps stepping outward every 12 nodes —
            // a fixed radius with `i*30` repeats coordinates at i and
            // i+12, stacking nodes on the exact same pixel (red-team).
            collisionUnresolved = true;
            slot = slotAt(
                cx, cy,
                MIN_RADIUS + (MAX_RINGS - 1 + Math.floor(i / 12)) * RADIUS_STEP,
                -90 + (i % 12) * 30,
            );
        }
        placed.push(slot);
        obstacles.push({ x: slot.x, y: slot.y, w: NODE_W, h: NODE_H });
    }

    const nodeIds = new Set(canvas.nodes.map((n) => n.id));
    const edgeIds = new Set(canvas.edges.map((e) => e.id));
    const newNodes: CanvasFileNode[] = [];
    const newEdges: CanvasEdge[] = [];

    for (let i = 0; i < fresh.length; i++) {
        const n = fresh[i];
        const nodeId = uniqueId(`${djb2Hex(n.path)}-x${i}`, nodeIds);
        const node: CanvasFileNode = {
            id: nodeId,
            type: "file",
            file: n.path,
            x: placed[i].x,
            y: placed[i].y,
            width: NODE_W,
            height: NODE_H,
        };
        if (n.tier === "cold") node.color = COLOR_COLD;
        newNodes.push(node);

        const { linked, direction } = classifyEdge(centerPath, n.path, links);
        const sides = sideForAngle(placed[i].angleDeg);
        const edge: CanvasEdge = {
            id: uniqueId(`e-${nodeId}`, edgeIds),
            fromNode: center.id,
            toNode: nodeId,
            fromSide: sides.fromSide,
            toSide: sides.toSide,
            fromEnd: linked && (direction === "in" || direction === "both") ? "arrow" : "none",
            toEnd: linked && (direction === "out" || direction === "both") ? "arrow" : "none",
            label: n.score.toFixed(2),
        };
        if (!linked) edge.color = COLOR_UNLINKED;
        newEdges.push(edge);
    }

    for (const n of toLink) {
        const target = fileNodes.find((fn) => fn.file === n.path)!;
        const angleDeg = (Math.atan2(
            target.y + target.height / 2 - cy,
            target.x + target.width / 2 - cx,
        ) * 180) / Math.PI;
        const sides = sideForAngle(angleDeg);
        const { linked, direction } = classifyEdge(centerPath, n.path, links);
        const edge: CanvasEdge = {
            id: uniqueId(`e-link-${target.id}`, edgeIds),
            fromNode: center.id,
            toNode: target.id,
            fromSide: sides.fromSide,
            toSide: sides.toSide,
            fromEnd: linked && (direction === "in" || direction === "both") ? "arrow" : "none",
            toEnd: linked && (direction === "out" || direction === "both") ? "arrow" : "none",
            label: n.score.toFixed(2),
        };
        if (!linked) edge.color = COLOR_UNLINKED;
        newEdges.push(edge);
    }

    // Convergence hubs: nodes whose incoming-edge count reaches HUB_DEGREE
    // get the orange marker on their frame and incoming edges. Touched
    // objects are cloned (originals stay pristine); protected colors —
    // center green, user-set — are never overwritten.
    const inDegree = new Map<string, number>();
    for (const e of [...canvas.edges, ...newEdges]) {
        inDegree.set(e.toNode, (inDegree.get(e.toNode) ?? 0) + 1);
    }
    const hubIds = new Set<string>();
    for (const n of [...canvas.nodes, ...newNodes]) {
        // Real canvases mix in text/group/link nodes (the CanvasJson type
        // undersells runtime reality) — only file nodes can be hubs, or a
        // user's sticky note pointed at by two edges gets painted.
        if (n.type !== "file") continue;
        if ((inDegree.get(n.id) ?? 0) >= HUB_DEGREE && MUTABLE_NODE_COLORS.has(n.color)) {
            hubIds.add(n.id);
        }
    }
    const paintNode = (n: CanvasFileNode) =>
        hubIds.has(n.id) && n.color !== COLOR_HUB ? { ...n, color: COLOR_HUB } : n;
    const paintEdge = (e: CanvasEdge) =>
        hubIds.has(e.toNode) && MUTABLE_EDGE_COLORS.has(e.color) && e.color !== COLOR_HUB
            ? { ...e, color: COLOR_HUB }
            : e;

    return {
        canvas: {
            nodes: [...canvas.nodes.map(paintNode), ...newNodes.map(paintNode)],
            edges: [...canvas.edges.map(paintEdge), ...newEdges.map(paintEdge)],
        },
        added: fresh.length,
        linkedExisting: toLink.length,
        totalNodes: canvas.nodes.length + newNodes.length,
        collisionUnresolved,
    };
}
