// Semantic Canvas Graph (006) — pure builder, no Obsidian imports.
//
// Turns a center note + its ranked semantic neighbors into a JSON Canvas
// 1.0 object (jsoncanvas.org): radial layout, edge color encodes link
// state (default gray = already linked, purple "6" = semantically close
// but not yet linked), node color encodes tier (cold = cyan "5").
//
// Neighbors must arrive pre-sorted by score descending — index 0 is
// placed at 12 o'clock and placement proceeds clockwise, so input order
// is the reading order.

export interface GraphNodeInput {
    path: string;
    tier: "hot" | "cold";
}

export interface GraphNeighborInput extends GraphNodeInput {
    score: number;
}

/** Mirror of Obsidian's metadataCache.resolvedLinks shape. */
export type ResolvedLinks = Record<string, Record<string, number>>;

export type CanvasSide = "top" | "right" | "bottom" | "left";

export interface CanvasFileNode {
    id: string;
    type: "file";
    file: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
}

/** JSON Canvas 1.0 text node (017): generic six fields + `text`, which the
 *  spec defines as "plain text with Markdown syntax" — callers MUST make
 *  user-supplied strings Markdown-safe (see buildResultsCanvas). */
export interface CanvasTextNode {
    id: string;
    type: "text";
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
}

export interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: CanvasSide;
    toSide?: CanvasSide;
    fromEnd?: "none" | "arrow";
    toEnd?: "none" | "arrow";
    color?: string;
    label?: string;
}

export interface CanvasJson {
    nodes: (CanvasFileNode | CanvasTextNode)[];
    edges: CanvasEdge[];
}

export const NODE_W = 400;
export const NODE_H = 360;
const CENTER_W = 480;
const CENTER_H = 420;
export const MIN_RADIUS = 760;
// Minimum center-to-center distance at which two 400×360 boxes cannot
// overlap in any relative direction: 400 / cos(atan(360/400)) ≈ 538.1.
export const CHORD_MIN = 540;

export const COLOR_CENTER = "4"; // green — anchor
export const COLOR_COLD = "5"; // cyan — possibly-forgotten old note
export const COLOR_UNLINKED = "6"; // purple — semantically close, not yet linked

export function classifyEdge(
    centerPath: string,
    neighborPath: string,
    links: ResolvedLinks,
): { linked: boolean; direction: "out" | "in" | "both" | null } {
    const out = (links[centerPath]?.[neighborPath] ?? 0) > 0;
    const inbound = (links[neighborPath]?.[centerPath] ?? 0) > 0;
    if (out && inbound) return { linked: true, direction: "both" };
    if (out) return { linked: true, direction: "out" };
    if (inbound) return { linked: true, direction: "in" };
    return { linked: false, direction: null };
}

export function sideForAngle(angleDeg: number): { fromSide: CanvasSide; toSide: CanvasSide } {
    // Normalize to [-180, 180)
    let a = ((angleDeg + 180) % 360 + 360) % 360 - 180;
    if (a >= -135 && a < -45) return { fromSide: "top", toSide: "bottom" };
    if (a >= -45 && a < 45) return { fromSide: "right", toSide: "left" };
    if (a >= 45 && a < 135) return { fromSide: "bottom", toSide: "top" };
    return { fromSide: "left", toSide: "right" };
}

/** k <= 0 returns empty arrays; k = 1 has no adjacent pair so radius
 *  stays at MIN_RADIUS (the chord formula divides by sin(π/k), which is
 *  0 at k=1). Callers guard k >= 1 via buildGraphCanvas's throw. */
export function layoutRadial(k: number): {
    radius: number;
    positions: { x: number; y: number }[];
    sides: { fromSide: CanvasSide; toSide: CanvasSide }[];
} {
    const radius = k <= 1
        ? MIN_RADIUS
        : Math.max(MIN_RADIUS, Math.ceil(CHORD_MIN / (2 * Math.sin(Math.PI / k))));
    const positions: { x: number; y: number }[] = [];
    const sides: { fromSide: CanvasSide; toSide: CanvasSide }[] = [];
    for (let i = 0; i < k; i++) {
        const angleDeg = -90 + i * (360 / k);
        const angleRad = (angleDeg * Math.PI) / 180;
        positions.push({
            x: Math.round(radius * Math.cos(angleRad)) - NODE_W / 2,
            y: Math.round(radius * Math.sin(angleRad)) - NODE_H / 2,
        });
        sides.push(sideForAngle(angleDeg));
    }
    return { radius, positions, sides };
}

export function djb2Hex(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
}

export function buildGraphCanvas(
    center: GraphNodeInput,
    neighbors: GraphNeighborInput[],
    links: ResolvedLinks,
): CanvasJson {
    if (neighbors.length === 0) {
        throw new Error("buildGraphCanvas: neighbors must be non-empty (caller guards zero results)");
    }

    const centerId = `${djb2Hex(center.path)}-0`;
    const nodes: CanvasFileNode[] = [{
        id: centerId,
        type: "file",
        file: center.path,
        x: -CENTER_W / 2,
        y: -CENTER_H / 2,
        width: CENTER_W,
        height: CENTER_H,
        color: COLOR_CENTER,
    }];

    const { positions, sides } = layoutRadial(neighbors.length);
    const edges: CanvasEdge[] = [];

    for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        const nodeId = `${djb2Hex(n.path)}-${i + 1}`;
        const node: CanvasFileNode = {
            id: nodeId,
            type: "file",
            file: n.path,
            x: positions[i].x,
            y: positions[i].y,
            width: NODE_W,
            height: NODE_H,
        };
        if (n.tier === "cold") node.color = COLOR_COLD;
        nodes.push(node);

        const { linked, direction } = classifyEdge(center.path, n.path, links);
        const edge: CanvasEdge = {
            id: `e-${nodeId}`,
            fromNode: centerId,
            toNode: nodeId,
            fromSide: sides[i].fromSide,
            toSide: sides[i].toSide,
            fromEnd: linked && (direction === "in" || direction === "both") ? "arrow" : "none",
            toEnd: linked && (direction === "out" || direction === "both") ? "arrow" : "none",
            label: n.score.toFixed(2),
        };
        if (!linked) edge.color = COLOR_UNLINKED;
        edges.push(edge);
    }

    return { nodes, edges };
}

export function graphCanvasFileName(
    basename: string,
    stamp: string,
    existingNames: Set<string>,
): string {
    const base = `${basename} · graph · ${stamp}`;
    let name = `${base}.canvas`;
    for (let n = 2; existingNames.has(name); n++) {
        name = `${base}-${n}.canvas`;
    }
    return name;
}

// ─── 017: search results → canvas ────────────────────────────────────────────

/** Center-edge color for results canvases: green, the same preset as
 *  COLOR_CENTER — anchor-family semantics (a green anchor emitting green
 *  relevance rays). Deliberately NOT gray (gray edges mean "already linked"
 *  in relation graphs) and NOT purple (reserved for unlinked note pairs). */
export const COLOR_RELEVANCE = "4";

/** Readability cap for results canvases; truncation is surfaced to the
 *  user via notice (never silent). */
export const RESULTS_CANVAS_CAP = 12;

/** Markdown-safe rendering of a user query for a text node: JSON Canvas
 *  defines `text` as Markdown, so `#tag` would render as a heading. Wrap
 *  in an inline-code fence one backtick longer than any run inside. */
export function markdownSafeQuery(query: string): string {
    const longestRun = (query.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0);
    const fence = "`".repeat(longestRun + 1);
    // Pad when the query starts/ends with a backtick (CommonMark rule).
    const pad = query.startsWith("`") || query.endsWith("`") ? " " : "";
    return `🔍 ${fence}${pad}${query}${pad}${fence}`;
}

/** Build the "these search results as a canvas" star: the query as a green
 *  text-node center, results laid out radially (score-desc, clockwise from
 *  12 o'clock — same reading order as relation graphs), every center edge
 *  green with the score as label. No arrows and no purple: edges from a
 *  text center carry relevance, not link state. */
export function buildResultsCanvas(
    query: string,
    results: GraphNeighborInput[],
): CanvasJson {
    if (results.length === 0) {
        throw new Error("buildResultsCanvas: results must be non-empty (caller guards zero results)");
    }

    const centerId = `${djb2Hex(`q:${query}`)}-0`;
    const nodes: (CanvasFileNode | CanvasTextNode)[] = [{
        id: centerId,
        type: "text",
        text: markdownSafeQuery(query),
        x: -CENTER_W / 2,
        y: -CENTER_H / 2,
        width: CENTER_W,
        height: CENTER_H,
        color: COLOR_CENTER,
    }];

    const { positions, sides } = layoutRadial(results.length);
    const edges: CanvasEdge[] = [];

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const nodeId = `${djb2Hex(r.path)}-${i + 1}`;
        const node: CanvasFileNode = {
            id: nodeId,
            type: "file",
            file: r.path,
            x: positions[i].x,
            y: positions[i].y,
            width: NODE_W,
            height: NODE_H,
        };
        if (r.tier === "cold") node.color = COLOR_COLD;
        nodes.push(node);

        edges.push({
            id: `e-${nodeId}`,
            fromNode: centerId,
            toNode: nodeId,
            fromSide: sides[i].fromSide,
            toSide: sides[i].toSide,
            fromEnd: "none",
            toEnd: "none",
            color: COLOR_RELEVANCE,
            label: r.score.toFixed(2),
        });
    }

    return { nodes, edges };
}

/** Filename-safe basename from a raw query. Order matters (red team C2/W3):
 *  strip illegal characters and leading dots FIRST, fall back to "search"
 *  only when the FILTERED result is empty, then cut at 24 code points
 *  (never .slice() — a code-unit cut can split an emoji surrogate pair). */
export function sanitizeQueryBasename(query: string): string {
    const filtered = query
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/^\.+/, "")
        .trim();
    if (filtered.length === 0) return "search";
    return Array.from(filtered).slice(0, 24).join("").trim() || "search";
}

/** Results-canvas naming — mirrors graphCanvasFileName's stamp format but
 *  with a `search` marker (red team W5: reusing the `graph` marker would
 *  mislabel the artifact). */
export function resultsCanvasFileName(
    queryBasename: string,
    stamp: string,
    existingNames: Set<string>,
): string {
    const base = `${queryBasename} · search · ${stamp}`;
    let name = `${base}.canvas`;
    for (let n = 2; existingNames.has(name); n++) {
        name = `${base}-${n}.canvas`;
    }
    return name;
}
