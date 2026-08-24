import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/utils/mergeSettings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('mergeSettings', () => {
    it('fills missing new fields with empty records (pre-013 data.json)', () => {
        const merged = mergeSettings({ topResults: 7 }, DEFAULT_SETTINGS);
        expect(merged.dismissedPairs).toEqual({});
        expect(merged.dismissedNotes).toEqual({});
        expect(merged.topResults).toBe(7);
    });

    it('keeps existing saved values over defaults', () => {
        const merged = mergeSettings(
            { dismissedPairs: { 'a.md\nb.md': 123 }, sameFolderCap: 0 },
            DEFAULT_SETTINGS,
        );
        expect(merged.dismissedPairs).toEqual({ 'a.md\nb.md': 123 });
        expect(merged.sameFolderCap).toBe(0);
    });

    it('falls back to defaults when raw settings is not an object', () => {
        for (const raw of [undefined, null, 'junk', 42, ['x']]) {
            const merged = mergeSettings(raw, DEFAULT_SETTINGS);
            expect(merged.topResults).toBe(DEFAULT_SETTINGS.topResults);
            expect(merged.dismissedPairs).toEqual({});
        }
    });

    it('sanitizes tampered dismissed records (array/string/non-number values → dropped)', () => {
        const merged = mergeSettings(
            {
                dismissedPairs: ['junk'] as unknown,
                dismissedNotes: { 'ok.md': 5, bad: 'text', alsoBad: NaN },
            },
            DEFAULT_SETTINGS,
        );
        expect(merged.dismissedPairs).toEqual({});
        expect(merged.dismissedNotes).toEqual({ 'ok.md': 5 });
    });

    it('defaults llmUrl to "" for settings saved before the field existed (023 case 5)', () => {
        const legacy = { ollamaUrl: 'http://localhost:11434', llmModel: 'qwen3:1.7b' };
        const merged = mergeSettings(legacy, DEFAULT_SETTINGS);
        expect(merged.llmUrl).toBe('');
    });

    it('never shares the dismissed records with DEFAULT_SETTINGS (in-place mutation stays local)', () => {
        const merged = mergeSettings(undefined, DEFAULT_SETTINGS);
        merged.dismissedPairs['a.md\nb.md'] = 1;
        merged.dismissedNotes['c.md'] = 2;
        expect(DEFAULT_SETTINGS.dismissedPairs).toEqual({});
        expect(DEFAULT_SETTINGS.dismissedNotes).toEqual({});
        expect(merged.dismissedPairs).not.toBe(DEFAULT_SETTINGS.dismissedPairs);
        expect(merged.dismissedNotes).not.toBe(DEFAULT_SETTINGS.dismissedNotes);
    });
});
