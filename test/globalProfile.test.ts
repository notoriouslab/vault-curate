import { describe, expect, it } from "vitest";
import {
    buildProfile,
    profileCentroid,
    groupedGlobalRank,
    type ProfileCandidate,
    type ColdRow,
} from "../src/search/globalProfile";
import { parseTags } from "../src/search/relatedFusion";

describe("parseTags (shared shape defense)", () => {
    it("keeps string elements of an array, trimmed", () => {
        expect(parseTags(["AI ", 1, null, " 教會"])).toEqual(["AI", "教會"]);
    });
    it("comma-splits a string value", () => {
        expect(parseTags("a, b ,, c")).toEqual(["a", "b", "c"]);
    });
    it("degrades non-array/non-string shapes to empty", () => {
        expect(parseTags(null)).toEqual([]);
        expect(parseTags({ a: 1 })).toEqual([]);
        expect(parseTags(42)).toEqual([]);
    });
    it("drops whitespace-only entries", () => {
        expect(parseTags(["  ", "x"])).toEqual(["x"]);
    });
});

function cand(path: string, judgedAt: number, tags: string[], exempt = false): ProfileCandidate {
    return { path, judgedAt, tags, exempt };
}

describe("buildProfile", () => {
    const df = new Map([["AI", 2], ["教會", 1], ["line對話", 50]]);
    const TOTAL = 100; // df ≤ 5 ⇒ topical

    it("orders by judgedAt desc and keeps only topical-tagged notes", () => {
        const out = buildProfile([
            cand("old.md", 1, ["AI"]),
            cand("new.md", 9, ["教會"]),
            cand("untagged.md", 8, []),
        ], df, TOTAL, 2);
        expect(out.paths).toEqual(["new.md", "old.md"]);
        expect(out.tags).toEqual(["教會", "AI"]);
    });

    it("excludes exempt (plugin-written) notes", () => {
        const out = buildProfile([
            cand("real.md", 5, ["AI"]),
            cand("ledger.md", 9, ["教會"], true),
        ], df, TOTAL);
        expect(out.paths).toEqual(["real.md"]);
    });

    it("structural tags (df above 5%) never qualify a note", () => {
        const out = buildProfile([cand("dlg.md", 9, ["line對話"])], df, TOTAL);
        expect(out.paths).toEqual(["dlg.md"]); // degradation path: no topical note
        expect(out.tags).toEqual([]);
    });

    it("df boundary is inclusive: exactly 5% still topical", () => {
        const df2 = new Map([["edge", 5]]);
        const out = buildProfile([cand("n.md", 1, ["edge"])], df2, 100);
        expect(out.tags).toEqual(["edge"]);
        const df3 = new Map([["edge", 6]]);
        expect(buildProfile([cand("n.md", 1, ["edge"])], df3, 100).tags).toEqual([]);
    });

    it("fewer than k topical notes: uses what exists", () => {
        const out = buildProfile([cand("a.md", 1, ["AI"])], df, TOTAL, 20);
        expect(out.paths).toEqual(["a.md"]);
    });

    it("no topical notes at all: centroid falls back to recent K, tags empty", () => {
        const out = buildProfile([
            cand("b.md", 2, []),
            cand("a.md", 9, ["line對話"]),
        ], df, TOTAL, 20);
        expect(out.paths).toEqual(["a.md", "b.md"]);
        expect(out.tags).toEqual([]);
    });

    it("tags are a cross-note multiset but deduped within one note", () => {
        const out = buildProfile([
            cand("x.md", 9, ["AI", "AI", "教會"]),
            cand("y.md", 8, ["AI"]),
        ], df, TOTAL);
        expect(out.tags).toEqual(["AI", "教會", "AI"]);
    });
});

describe("profileCentroid", () => {
    it("skips NaN-poisoned vectors", () => {
        const good = new Float32Array([1, 0]);
        const bad = new Float32Array([NaN, 1]);
        const c = profileCentroid([bad, good, good]);
        expect(c).not.toBeNull();
        expect(c![0]).toBeCloseTo(1);
        expect(c![1]).toBeCloseTo(0);
    });
    it("returns null when every vector is unusable", () => {
        expect(profileCentroid([new Float32Array([NaN, 1])])).toBeNull();
        expect(profileCentroid([])).toBeNull();
    });
});

function row(path: string, sim: number, title = path): ColdRow & { vec: Float32Array } {
    // centroid = e0; vec with vec[0]=sim gives dot=sim
    const v = new Float32Array(2);
    v[0] = sim;
    v[1] = Math.sqrt(Math.max(0, 1 - sim * sim));
    return { path, title, tier: "cold", vec: v };
}
const E0 = new Float32Array([1, 0]);
const OPTS = { minScore: 0.5 };

describe("groupedGlobalRank", () => {
    it("empty input returns empty", () => {
        expect(groupedGlobalRank([], E0, new Map(), OPTS)).toEqual([]);
    });

    it("groups by top-level folder, root notes under '/'", () => {
        const out = groupedGlobalRank([
            row("a/x.md", 0.9), row("b/y.md", 0.8), row("root.md", 0.7),
        ], E0, new Map(), OPTS);
        expect(out.map((g) => g.group)).toEqual(["a", "b", "/"]);
    });

    it("takes at most groupTake per group in fused order", () => {
        const out = groupedGlobalRank([
            row("a/1.md", 0.9), row("a/2.md", 0.85), row("a/3.md", 0.8), row("a/4.md", 0.75),
        ], E0, new Map(), OPTS);
        expect(out[0].results.map((r) => r.path)).toEqual(["a/1.md", "a/2.md", "a/3.md"]);
    });

    it("kwRank reorders within a group", () => {
        const out = groupedGlobalRank([
            row("a/1.md", 0.9), row("a/2.md", 0.85), row("a/3.md", 0.8),
        ], E0, new Map([["a/3.md", 1]]), OPTS);
        expect(out[0].results[0].path).toBe("a/3.md");
    });

    it("group order follows the best member's SEMANTIC score, not fused position", () => {
        // group b's best sem (0.88) beats group a's best sem (0.86) even
        // though a has the keyword hit.
        const out = groupedGlobalRank([
            row("a/1.md", 0.86), row("b/1.md", 0.88),
        ], E0, new Map([["a/1.md", 1]]), OPTS);
        expect(out.map((g) => g.group)).toEqual(["b", "a"]);
    });

    it("drops groups whose members are all below minScore", () => {
        const out = groupedGlobalRank([
            row("a/1.md", 0.9), row("weak/1.md", 0.3),
        ], E0, new Map(), OPTS);
        expect(out.map((g) => g.group)).toEqual(["a"]);
    });

    it("skips NaN similarity rows instead of poisoning the sort", () => {
        const bad = { path: "a/bad.md", title: "bad", tier: "cold" as const, vec: new Float32Array([NaN, 0]) };
        const out = groupedGlobalRank([bad, row("a/ok.md", 0.9)], E0, new Map(), OPTS);
        expect(out[0].results.map((r) => r.path)).toEqual(["a/ok.md"]);
    });

    it("group-order tie breaks lexically for determinism", () => {
        const out = groupedGlobalRank([
            row("b/1.md", 0.9), row("a/1.md", 0.9),
        ], E0, new Map(), OPTS);
        expect(out.map((g) => g.group)).toEqual(["a", "b"]);
    });

    it("pool truncation: only the group's semantic top groupPool enter fusion", () => {
        const rows = Array.from({ length: 25 }, (_, i) => row(`a/${i}.md`, 0.9 - i * 0.01));
        // keyword hit on a note ranked 24th semantically — outside pool 20,
        // can never enter the output.
        const out = groupedGlobalRank(rows, E0, new Map([["a/24.md", 1]]), { minScore: 0.5, groupPool: 20 });
        expect(out[0].results.map((r) => r.path)).not.toContain("a/24.md");
    });
});
