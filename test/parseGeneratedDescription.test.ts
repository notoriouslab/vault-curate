import { describe, it, expect } from 'vitest';
import { parseGeneratedDescription } from '../src/utils/parseGeneratedDescription';

// Control / invisible code points that must never reach frontmatter.
const ESC = '\x1b';      // ANSI escape
const NUL = '\x00';
const CR = '\r';
const TAG = '\u{E0041}'; // Plane-14 tag char (steganography carrier)

describe('parseGeneratedDescription', () => {
    it('parses clean JSON with description + tags', () => {
        const r = parseGeneratedDescription('{"description":"a topic","tags":["x","y"]}');
        expect(r.description).toBe('a topic');
        expect(r.tags).toEqual(['x', 'y']);
    });

    it('accepts the summary alias for description', () => {
        expect(parseGeneratedDescription('{"summary":"via summary"}').description).toBe('via summary');
    });

    it('coerces a separator-delimited tag string', () => {
        expect(parseGeneratedDescription('{"description":"d","tags":"a b、c"}').tags).toEqual(['a', 'b', 'c']);
    });

    it('strips control/invisible chars on the JSON path', () => {
        const r = parseGeneratedDescription(`{"description":"clean${ESC}[31m${NUL} text"}`);
        expect(r.description).not.toMatch(/[\x00-\x1f]/);
        expect(r.description).not.toContain(TAG);
    });

    // 1.6.0 red-team §4: a non-JSON reply falls through to the last-resort
    // branch — which used to write raw text verbatim. It must sanitize too.
    it('sanitizes the non-JSON fallback branch (red-team §4)', () => {
        const chatty = `Sorry, I can't do that.${ESC}[31mFAKE${ESC}[0m${NUL}${CR}injected: line${TAG}payload`;
        const r = parseGeneratedDescription(chatty);
        expect(r.description.length).toBeGreaterThan(0);       // fallback still returns something
        expect(r.description).not.toMatch(/[\x00-\x08\x0e-\x1f]/); // no ANSI/NUL/control
        expect(r.description).not.toContain(TAG);              // no Plane-14 tag char
        expect(r.tags).toBeUndefined();
    });

    it('caps the fallback description length', () => {
        const long = 'x'.repeat(5000); // not JSON
        expect(parseGeneratedDescription(long).description.length).toBeLessThanOrEqual(500);
    });
});
