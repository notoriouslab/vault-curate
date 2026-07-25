import { describe, expect, it } from "vitest";
import { buildPseudoQuery, fuseRanks } from "../src/search/relatedFusion";

describe("buildPseudoQuery", () => {
    it("tags REPLACE the title when present, keeping only string elements (register-poison rule)", () => {
        expect(buildPseudoQuery("教會 AI 總務助理（LINE × AI）導入規畫書", ["AI", "教會", 42, null, "總務"]))
            .toBe("AI 教會 總務");
    });

    it("splits a string tags value on commas", () => {
        expect(buildPseudoQuery("Note", "a, b ,, c")).toBe("a b c");
    });

    it("treats null/undefined/objects as no tags", () => {
        expect(buildPseudoQuery("Note", null)).toBe("Note");
        expect(buildPseudoQuery("Note", undefined)).toBe("Note");
        expect(buildPseudoQuery("Note", { a: 1 })).toBe("Note");
    });

    it("array of only non-strings degrades to title-only", () => {
        expect(buildPseudoQuery("Note", [1, {}, []])).toBe("Note");
    });

    it("empty basename with tags still yields the tag text", () => {
        expect(buildPseudoQuery("", ["x"])).toBe("x");
    });

    it("whitespace-only tag entries are dropped; remaining tags still replace the title", () => {
        expect(buildPseudoQuery("Note", ["  ", "real"])).toBe("real");
    });

    it("falls back to the title when every tag is non-string or blank", () => {
        expect(buildPseudoQuery("Note", [1, "  "])).toBe("Note");
    });
});

describe("fuseRanks", () => {
    const POOL = ["a", "b", "c", "d"];

    it("empty pool returns empty", () => {
        expect(fuseRanks([], new Map([["x", 1]]))).toEqual([]);
    });

    it("empty kwRank returns the input order unchanged (pure-cosine degradation)", () => {
        expect(fuseRanks(POOL, new Map())).toEqual(POOL);
    });

    it("keyword hits promote lower-cosine entries", () => {
        // d is cosine-last but keyword-first: with k=60 it should overtake
        // b and c (no hits) but 1/(60+1)+1/(60+4) vs a's 1/(60+1) alone.
        const out = fuseRanks(POOL, new Map([["d", 1]]), 60);
        expect(out[0]).toBe("d");
        expect(out.slice(1)).toEqual(["a", "b", "c"]);
    });

    it("paths outside the pool can never enter the output", () => {
        const out = fuseRanks(POOL, new Map([["zzz", 1]]));
        expect(out).toEqual(POOL);
        expect(out).not.toContain("zzz");
    });

    it("symmetric rank pairs tie-break to the smaller cosRank", () => {
        // a: cosRank1 + kwRank3; c: cosRank3 + kwRank1 → identical fused.
        const out = fuseRanks(["a", "b", "c"], new Map([["a", 3], ["c", 1]]), 60);
        expect(out.indexOf("a")).toBeLessThan(out.indexOf("c"));
    });

    it("single element passes through", () => {
        expect(fuseRanks(["only"], new Map([["only", 1]]))).toEqual(["only"]);
    });

    it("both-hit ordering follows combined ranks", () => {
        // b (cos2, kw1) must beat a (cos1, kw3): 1/62+1/61 > 1/61+1/63.
        const out = fuseRanks(["a", "b"], new Map([["a", 3], ["b", 1]]), 60);
        expect(out).toEqual(["b", "a"]);
    });

    it("pilot mini-fixture: register-twin without hits is evicted from the top", () => {
        // cosine order: junk twins j1 j2 at the top, topical t1 t2 below
        // with keyword hits — fusion must put t1/t2 first.
        const pool = ["j1", "j2", "t1", "t2", "j3"];
        const out = fuseRanks(pool, new Map([["t1", 1], ["t2", 2]]), 60);
        expect(out.slice(0, 2)).toEqual(["t1", "t2"]);
    });

    it("determinism: repeated calls give identical output", () => {
        const kw = new Map([["a", 2], ["c", 2]]);
        const once = fuseRanks(POOL, kw);
        expect(fuseRanks(POOL, kw)).toEqual(once);
    });
});
