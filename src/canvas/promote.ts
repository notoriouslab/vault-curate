// Purple-edge promotion (010 D1/D4) — pure builders, no Obsidian imports.
//
// A purple edge (COLOR_UNLINKED "6") records "semantically close, not yet
// linked". Promotion turns that suggestion into a real wikilink, confirmed
// edge by edge by the user (判定動作 — the tool suggests, the human
// decides). Matching granularity is the FILE PAIR, not stored edge ids:
// apply-time rescans the freshly-read canvas, so edges the user deleted or
// recolored while the modal was open simply fail to match and are counted
// as skipped.

import {
    COLOR_UNLINKED,
    type CanvasEdge,
    type CanvasJson,
    type ResolvedLinks,
} from "./graphCanvas";

export interface PurplePair {
    /** File path of the edge's fromNode — the source note the wikilink is
     *  written into (and, in bidirectional mode, also the target of the
     *  reverse link). */
    from: string;
    to: string;
    /** Max numeric edge label across this pair's purple edges; undefined
     *  when no label parses as a number (hand-edited canvas). */
    score?: number;
}

function pairKey(a: string, b: string): string {
    return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** Both endpoints resolved to .md file paths, or null. Non-file nodes
 *  (text/group/link) and non-markdown files never qualify. */
function edgeFilePair(
    edge: CanvasEdge,
    idToFile: Map<string, string>,
): { from: string; to: string } | null {
    const from = idToFile.get(edge.fromNode);
    const to = idToFile.get(edge.toNode);
    if (from === undefined || to === undefined) return null;
    if (!from.endsWith(".md") || !to.endsWith(".md")) return null;
    if (from === to) return null;
    return { from, to };
}

/**
 * Scan a canvas for promotable purple edges (010 D1). Qualifying edge:
 * color === "6", both endpoints are existing .md file nodes, and the pair
 * is not already linked in either direction per `links` — the canvas may
 * be stale, so link state is re-verified against the live resolvedLinks,
 * regardless of which tool drew the edge. Deduped at file-pair level
 * (first orientation encountered wins, scores max-pooled), in edge-array
 * order for deterministic display.
 */
export function collectPurpleEdges(
    canvas: CanvasJson,
    links: ResolvedLinks,
    fileExists: (path: string) => boolean,
): PurplePair[] {
    const idToFile = new Map(
        canvas.nodes.filter((n) => n.type === "file").map((n) => [n.id, n.file]),
    );
    const byKey = new Map<string, PurplePair>();

    for (const edge of canvas.edges) {
        if (edge.color !== COLOR_UNLINKED) continue;
        const pair = edgeFilePair(edge, idToFile);
        if (!pair) continue;
        if (!fileExists(pair.from) || !fileExists(pair.to)) continue;
        const linked = (links[pair.from]?.[pair.to] ?? 0) > 0
            || (links[pair.to]?.[pair.from] ?? 0) > 0;
        if (linked) continue;

        const score = edge.label !== undefined && edge.label.trim() !== ""
            ? Number(edge.label)
            : NaN;
        const key = pairKey(pair.from, pair.to);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, {
                ...pair,
                score: Number.isFinite(score) ? score : undefined,
            });
        } else if (Number.isFinite(score)
            && (existing.score === undefined || score > existing.score)) {
            existing.score = score;
        }
    }
    return [...byKey.values()];
}

export interface PromoteCanvasResult {
    /** New canvas object; untouched node/edge objects keep their original
     *  references (append-only spirit — only matched edges are cloned). */
    canvas: CanvasJson;
    /** Number of edges recolored. */
    changedEdges: number;
    /** Pair keys that matched at least one edge. */
    matchedPairs: Set<string>;
}

/**
 * Recolor every purple edge of the accepted `pairs` (010 D4): clone the
 * edge, drop the purple color (back to default gray), and set arrowheads
 * for the now-real link. The wikilink was written pair.from → pair.to, so
 * the arrow must point at pair.to's node whichever way the edge happens to
 * be drawn (a hand-drawn or expansion edge can run in the reverse
 * orientation) — both ends when `bidirectional`. Edges whose color is no
 * longer "6" (user recolored meanwhile) don't match; callers diff
 * `matchedPairs` against their request to count skips.
 */
export function promoteEdgesInCanvas(
    canvas: CanvasJson,
    pairs: Array<{ from: string; to: string }>,
    bidirectional: boolean,
): PromoteCanvasResult {
    const wanted = new Map(pairs.map((p) => [pairKey(p.from, p.to), p]));
    const idToFile = new Map(
        canvas.nodes.filter((n) => n.type === "file").map((n) => [n.id, n.file]),
    );

    const matchedPairs = new Set<string>();
    let changedEdges = 0;
    const edges = canvas.edges.map((edge) => {
        if (edge.color !== COLOR_UNLINKED) return edge;
        const pair = edgeFilePair(edge, idToFile);
        if (!pair) return edge;
        const key = pairKey(pair.from, pair.to);
        const accepted = wanted.get(key);
        if (!accepted) return edge;

        matchedPairs.add(key);
        changedEdges++;
        // Link direction in file terms: accepted.from → accepted.to. On a
        // reverse-drawn edge that lands on the fromEnd side.
        const linkPointsAtToNode = pair.to === accepted.to;
        const promoted: CanvasEdge = {
            ...edge,
            fromEnd: bidirectional || !linkPointsAtToNode
                ? "arrow"
                : edge.fromEnd ?? "none",
            toEnd: bidirectional || linkPointsAtToNode
                ? "arrow"
                : edge.toEnd ?? "none",
        };
        delete promoted.color;
        return promoted;
    });

    if (changedEdges === 0) {
        return { canvas, changedEdges: 0, matchedPairs };
    }
    return {
        canvas: { ...canvas, nodes: canvas.nodes, edges },
        changedEdges,
        matchedPairs,
    };
}

export { pairKey };
