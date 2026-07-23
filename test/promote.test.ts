import { describe, expect, it } from "vitest";
import { collectPurpleEdges, promoteEdgesInCanvas } from "../src/canvas/promote";
import {
    COLOR_UNLINKED,
    type CanvasEdge,
    type CanvasFileNode,
    type CanvasJson,
    type ResolvedLinks,
} from "../src/canvas/graphCanvas";

function fileNode(id: string, file: string): CanvasFileNode {
    return { id, type: "file", file, x: 0, y: 0, width: 400, height: 360 };
}

function purple(id: string, fromNode: string, toNode: string, label?: string): CanvasEdge {
    return { id, fromNode, toNode, color: COLOR_UNLINKED, label };
}

const NO_LINKS: ResolvedLinks = {};
const allExist = () => true;

function canvasOf(nodes: CanvasFileNode[], edges: CanvasEdge[]): CanvasJson {
    return { nodes, edges };
}

describe("collectPurpleEdges", () => {
    const a = fileNode("na", "A.md");
    const b = fileNode("nb", "B.md");
    const c = fileNode("nc", "C.md");

    it("collects a qualifying purple edge with its numeric score", () => {
        const pairs = collectPurpleEdges(
            canvasOf([a, b], [purple("e1", "na", "nb", "0.83")]), NO_LINKS, allExist);
        expect(pairs).toEqual([{ from: "A.md", to: "B.md", score: 0.83 }]);
    });

    it("filters pairs already linked in either direction (stale canvas re-verification)", () => {
        const linksOut: ResolvedLinks = { "A.md": { "B.md": 1 } };
        const linksIn: ResolvedLinks = { "B.md": { "A.md": 2 } };
        const cv = canvasOf([a, b], [purple("e1", "na", "nb")]);
        expect(collectPurpleEdges(cv, linksOut, allExist)).toEqual([]);
        expect(collectPurpleEdges(cv, linksIn, allExist)).toEqual([]);
    });

    it("skips edges touching non-file nodes (real canvases mix in text/group nodes)", () => {
        const textNode = { id: "nt", type: "text", text: "sticky", x: 0, y: 0, width: 100, height: 100 } as unknown as CanvasFileNode;
        const pairs = collectPurpleEdges(
            canvasOf([a, textNode], [purple("e1", "na", "nt")]), NO_LINKS, allExist);
        expect(pairs).toEqual([]);
    });

    it("skips non-.md endpoints and self-pairs", () => {
        const img = fileNode("ni", "pic.png");
        const a2 = fileNode("na2", "A.md");
        const pairs = collectPurpleEdges(
            canvasOf([a, img, a2], [purple("e1", "na", "ni"), purple("e2", "na", "na2")]),
            NO_LINKS, allExist);
        expect(pairs).toEqual([]);
    });

    it("dedupes at pair level, max-pooling scores and tolerating non-numeric labels", () => {
        const pairs = collectPurpleEdges(
            canvasOf([a, b], [
                purple("e1", "na", "nb", "0.71"),
                purple("e2", "nb", "na", "0.85"),
                purple("e3", "na", "nb", "hand-edited"),
            ]),
            NO_LINKS, allExist);
        expect(pairs).toEqual([{ from: "A.md", to: "B.md", score: 0.85 }]);
    });

    it("keeps score undefined when no label parses as a number", () => {
        const pairs = collectPurpleEdges(
            canvasOf([a, b], [purple("e1", "na", "nb", "n/a")]), NO_LINKS, allExist);
        expect(pairs).toEqual([{ from: "A.md", to: "B.md", score: undefined }]);
    });

    it("skips pairs whose endpoint file no longer exists", () => {
        const pairs = collectPurpleEdges(
            canvasOf([a, b], [purple("e1", "na", "nb")]),
            NO_LINKS, (p) => p !== "B.md");
        expect(pairs).toEqual([]);
    });

    it("empty canvas and gray edges yield nothing", () => {
        const gray: CanvasEdge = { id: "e1", fromNode: "na", toNode: "nb" };
        expect(collectPurpleEdges(canvasOf([], []), NO_LINKS, allExist)).toEqual([]);
        expect(collectPurpleEdges(canvasOf([a, b, c], [gray]), NO_LINKS, allExist)).toEqual([]);
    });
});

describe("promoteEdgesInCanvas", () => {
    const a = fileNode("na", "A.md");
    const b = fileNode("nb", "B.md");
    const c = fileNode("nc", "C.md");
    const AB = [{ from: "A.md", to: "B.md" }];

    it("recolors the matched edge: color dropped, toEnd arrow, fromEnd preserved when unidirectional", () => {
        const cv = canvasOf([a, b], [{ ...purple("e1", "na", "nb", "0.8"), fromEnd: "none", toEnd: "none" }]);
        const r = promoteEdgesInCanvas(cv, AB, false);
        expect(r.changedEdges).toBe(1);
        expect(r.canvas.edges[0]).toEqual({
            id: "e1", fromNode: "na", toNode: "nb", label: "0.8",
            fromEnd: "none", toEnd: "arrow",
        });
        expect("color" in r.canvas.edges[0]).toBe(false);
    });

    it("bidirectional promotion sets both arrowheads", () => {
        const cv = canvasOf([a, b], [purple("e1", "na", "nb")]);
        const r = promoteEdgesInCanvas(cv, AB, true);
        expect(r.canvas.edges[0].fromEnd).toBe("arrow");
        expect(r.canvas.edges[0].toEnd).toBe("arrow");
    });

    it("non-selected purple edges keep their original object reference", () => {
        const other = purple("e2", "na", "nc");
        const cv = canvasOf([a, b, c], [purple("e1", "na", "nb"), other]);
        const r = promoteEdgesInCanvas(cv, AB, true);
        expect(r.canvas.edges[1]).toBe(other);
        expect(r.canvas.nodes).toBe(cv.nodes);
    });

    it("edge recolored by the user meanwhile (color no longer 6) does not match", () => {
        const red: CanvasEdge = { ...purple("e1", "na", "nb"), color: "1" };
        const r = promoteEdgesInCanvas(canvasOf([a, b], [red]), AB, true);
        expect(r.changedEdges).toBe(0);
        expect(r.matchedPairs.size).toBe(0);
        expect(r.canvas.edges[0]).toBe(red);
    });

    it("every purple edge of the pair changes, whichever orientation it was drawn in", () => {
        const cv = canvasOf([a, b], [purple("e1", "na", "nb"), purple("e2", "nb", "na")]);
        const r = promoteEdgesInCanvas(cv, AB, false);
        expect(r.changedEdges).toBe(2);
        expect(r.canvas.edges.every((e) => e.color === undefined)).toBe(true);
    });

    it("reverse-drawn edge gets the arrow on the end the link actually points at (review W2)", () => {
        // Link written A→B points at B; this edge is drawn B→A, so B is
        // its fromNode and the arrowhead belongs on the fromEnd.
        const cv = canvasOf([a, b], [purple("e1", "nb", "na")]);
        const r = promoteEdgesInCanvas(cv, AB, false);
        expect(r.canvas.edges[0].fromEnd).toBe("arrow");
        expect(r.canvas.edges[0].toEnd).toBe("none");
    });

    it("whitespace-only label yields undefined score, not 0 (review I4)", () => {
        const pairs = collectPurpleEdges(
            canvasOf([a, b], [purple("e1", "na", "nb", "  ")]), NO_LINKS, allExist);
        expect(pairs).toEqual([{ from: "A.md", to: "B.md", score: undefined }]);
    });

    it("no match returns the input canvas object itself", () => {
        const cv = canvasOf([a, c], [purple("e1", "na", "nc")]);
        const r = promoteEdgesInCanvas(cv, AB, true);
        expect(r.canvas).toBe(cv);
        expect(r.changedEdges).toBe(0);
    });
});
