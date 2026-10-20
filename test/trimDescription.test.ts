import { describe, it, expect } from 'vitest';
import {
    DESCRIPTION_WIDTH_CAP,
    isLegacyTruncatedDescription,
    trimDescription,
} from '../src/utils/sanitize';
import { displayWidth } from '../src/utils/textWidth';
import { parseGeneratedDescription } from '../src/utils/parseGeneratedDescription';

const sentence = (len: number, end = '.') => 'a'.repeat(len - 1) + end;

describe('trimDescription (040 D3)', () => {
    it('keeps descriptions within the width cap unchanged', () => {
        const en = 'x'.repeat(400);
        const zh = '字'.repeat(240);
        expect(trimDescription(en)).toBe(en);
        expect(trimDescription(zh)).toBe(zh);
    });

    it('cuts English at the last sentence end within the cap', () => {
        const s1 = sentence(240);
        const s2 = sentence(239);           // ends at 240 + 1 + 239 = 480
        const s3 = sentence(139);
        const desc = `${s1} ${s2} ${s3}`;   // 620 chars
        expect(desc.length).toBe(620);
        expect(trimDescription(desc)).toBe(`${s1} ${s2}`);
    });

    it('cuts Chinese at a full stop even when the next sentence follows without a space', () => {
        const s = (n: number) => '字'.repeat(n - 1) + '。';
        const desc = s(80) + s(80) + s(75) + s(65);   // 300 chars, width 600
        const out = trimDescription(desc);
        expect(out).toBe(s(80) + s(80) + s(75));
        expect(displayWidth(out)).toBe(470);
    });

    it('keeps the closing quote after a sentence end', () => {
        const head = '字'.repeat(200) + '說完了。」';
        const desc = head + '下一句' + '字'.repeat(100);
        expect(trimDescription(desc)).toBe(head);
    });

    it('falls back to an ellipsis when there is no sentence end', () => {
        const out = trimDescription('word '.repeat(200));
        expect(displayWidth(out)).toBeLessThanOrEqual(DESCRIPTION_WIDTH_CAP);
        expect(out.endsWith('…')).toBe(true);
        // A trimmed description must never look like the old 500-char cut
        // (G1 C2), or every batch would regenerate it.
        expect(isLegacyTruncatedDescription(out)).toBe(false);
    });

    it('does not treat a decimal point as a sentence end, even right at the cap', () => {
        // "1." ends exactly at width 500: a search over the cut prefix would see
        // "1." at the end of the string and take it for a sentence end (G1 W5).
        const desc = 'b'.repeat(400) + '. ' + 'x'.repeat(95) + ' 1.5 more ' + 'c'.repeat(50);
        expect(desc.indexOf('1.5') + 2).toBe(500);
        expect(trimDescription(desc)).toBe('b'.repeat(400) + '.');
    });

    it('known limit: an abbreviation counts as a sentence end', () => {
        const desc = 'a '.repeat(240) + 'Use e.g. hammers and nails for this job. ' + 'z'.repeat(200);
        expect(trimDescription(desc).endsWith('e.g.')).toBe(true);
    });

    it('keeps a curly closing quote after a period', () => {
        const head = 'a '.repeat(230) + 'She said “yes.”';
        const desc = head + ' Then ' + 'z'.repeat(100);
        expect(trimDescription(desc)).toBe(head);
    });

    it('parser still applies a hard cap', () => {
        expect(parseGeneratedDescription('x'.repeat(5000)).description.length).toBeLessThanOrEqual(1000);
    });
});

describe('isLegacyTruncatedDescription (040 D6)', () => {
    const word = (n: number) => 'a'.repeat(n);

    it('flags 500 or 499 code units ending mid-word', () => {
        expect(isLegacyTruncatedDescription(word(500))).toBe(true);
        expect(isLegacyTruncatedDescription(word(499))).toBe(true);
    });

    it('does not flag a description ending at a sentence end, closer or ellipsis', () => {
        expect(isLegacyTruncatedDescription(word(499) + '.')).toBe(false);
        expect(isLegacyTruncatedDescription(word(498) + '。」')).toBe(false);
        expect(isLegacyTruncatedDescription(word(498) + '.”')).toBe(false);
        expect(isLegacyTruncatedDescription(word(499) + '…')).toBe(false);
    });

    it('ignores other lengths and non-strings', () => {
        expect(isLegacyTruncatedDescription(word(498))).toBe(false);
        expect(isLegacyTruncatedDescription(word(501))).toBe(false);
        expect(isLegacyTruncatedDescription(500)).toBe(false);
        expect(isLegacyTruncatedDescription(undefined)).toBe(false);
    });

    it('accepted residual: a new 500-char description ending in a letter is flagged again', () => {
        // Width <= 500 is written as is, so trimDescription keeps it and the
        // next batch regenerates it (040 D6, second-round W6).
        const desc = word(500);
        expect(trimDescription(desc)).toBe(desc);
        expect(isLegacyTruncatedDescription(desc)).toBe(true);
    });
});
