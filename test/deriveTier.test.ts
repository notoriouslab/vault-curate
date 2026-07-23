import { describe, expect, it } from "vitest";
import { deriveTier, SELF_WRITE_TOLERANCE_MS } from "../src/heat/deriveTier";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const HOT_DAYS = 90;
const OLD = NOW - 400 * DAY;

const base = {
    created: OLD,
    mtime: OLD,
    hasOutgoing: false,
    hasIncoming: false,
    now: NOW,
    hotDays: HOT_DAYS,
};

describe("deriveTier", () => {
    it("recently created note is hot", () => {
        expect(deriveTier({ ...base, created: NOW - 1 * DAY, mtime: NOW - 1 * DAY })).toBe("hot");
    });

    it("old orphan edited last week is hot (the 010 fix — ctime-only judged this cold)", () => {
        expect(deriveTier({ ...base, mtime: NOW - 7 * DAY })).toBe("hot");
    });

    it("old, unedited, unlinked note is cold", () => {
        expect(deriveTier(base)).toBe("cold");
    });

    it("incoming link alone makes an old note hot", () => {
        expect(deriveTier({ ...base, hasIncoming: true })).toBe("hot");
    });

    it("outgoing link alone makes an old note hot", () => {
        expect(deriveTier({ ...base, hasOutgoing: true })).toBe("hot");
    });

    it("self-write exemption: plugin batch write does not re-heat", () => {
        const mtime = NOW - 1 * DAY;
        expect(deriveTier({ ...base, mtime, selfWriteMtime: mtime })).toBe("cold");
    });

    it("exemption tolerance boundary: within ±2000ms exempt, beyond counts as user edit", () => {
        const mtime = NOW - 1 * DAY;
        expect(deriveTier({ ...base, mtime, selfWriteMtime: mtime - SELF_WRITE_TOLERANCE_MS })).toBe("cold");
        expect(deriveTier({ ...base, mtime, selfWriteMtime: mtime - SELF_WRITE_TOLERANCE_MS - 1 })).toBe("hot");
    });

    it("hotDays window boundary is strict <: exactly at the window is cold, 1ms inside is hot", () => {
        const hotMs = HOT_DAYS * DAY;
        expect(deriveTier({ ...base, mtime: NOW - hotMs })).toBe("cold");
        expect(deriveTier({ ...base, mtime: NOW - hotMs + 1 })).toBe("hot");
    });

    it("exemption falls back to created, not to cold: recently created + exempt write stays hot", () => {
        const mtime = NOW - 1 * DAY;
        expect(deriveTier({
            ...base,
            created: NOW - 2 * DAY,
            mtime,
            selfWriteMtime: mtime,
        })).toBe("hot");
    });

    it("stale ledger entry (old exempt write, then real user edit) does not exempt the new edit", () => {
        expect(deriveTier({
            ...base,
            mtime: NOW - 1 * DAY,
            selfWriteMtime: NOW - 30 * DAY,
        })).toBe("hot");
    });
});
