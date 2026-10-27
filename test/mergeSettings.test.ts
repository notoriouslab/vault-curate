import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/utils/mergeSettings';
import { DEFAULT_SETTINGS } from '../src/types';
import { resolveLlmApiKey } from '../src/utils/resolveLlmApiKey';

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

    it('defaults the AI output language fields for pre-036 data.json', () => {
        const merged = mergeSettings({}, DEFAULT_SETTINGS);
        expect(merged.aiOutputLanguage).toBe('auto');
        expect(merged.aiOutputLanguageCustom).toBe('');
    });

    it('keeps a listed AI output language', () => {
        expect(mergeSettings({ aiOutputLanguage: 'zh-TW' }, DEFAULT_SETTINGS).aiOutputLanguage).toBe('zh-TW');
    });

    it('falls back to auto for a hand-edited value outside the list, and "" for a non-string name', () => {
        const merged = mergeSettings({ aiOutputLanguage: 'fr', aiOutputLanguageCustom: 5 }, DEFAULT_SETTINGS);
        expect(merged.aiOutputLanguage).toBe('auto');
        expect(merged.aiOutputLanguageCustom).toBe('');
    });

    it('stores the custom language name as typed (sanitised only at use time)', () => {
        const merged = mergeSettings(
            { aiOutputLanguage: 'custom', aiOutputLanguageCustom: '  Fran\nçais ' }, DEFAULT_SETTINGS);
        expect(merged.aiOutputLanguage).toBe('custom');
        expect(merged.aiOutputLanguageCustom).toBe('  Fran\nçais ');
    });

    it('defaults the model download fields for pre-039 data.json and repairs hand edits (039)', () => {
        const fresh = mergeSettings({}, DEFAULT_SETTINGS);
        expect(fresh.modelDownloadSource).toBe('huggingface');
        expect(fresh.modelDownloadUrl).toBe('');
        const edited = mergeSettings({ modelDownloadSource: 'hf-mirror', modelDownloadUrl: 123 }, DEFAULT_SETTINGS);
        expect(edited.modelDownloadSource).toBe('huggingface');
        expect(edited.modelDownloadUrl).toBe('');
        const custom = mergeSettings({ modelDownloadSource: 'custom', modelDownloadUrl: 'https://m.test' }, DEFAULT_SETTINGS);
        expect(custom.modelDownloadSource).toBe('custom');
        expect(custom.modelDownloadUrl).toBe('https://m.test');
    });
});

describe('041 D3 key migration', () => {
    const run = (raw: unknown) => {
        const m = mergeSettings(raw, DEFAULT_SETTINGS);
        return { llmApiKey: m.llmApiKey, apiKey: m.apiKey, sent: resolveLlmApiKey(m), merged: m };
    };

    it('M1 external embedding, curation off, shared server: nothing copied', () => {
        const r = run({ embeddingProvider: 'ollama', enableAICuration: false, llmUrl: '', apiKey: 'k' });
        expect([r.llmApiKey, r.sent]).toEqual(['', 'k']);
    });

    it('M2 external embedding, curation on, shared server: reuses the key', () => {
        const r = run({ embeddingProvider: 'ollama', enableAICuration: true, llmUrl: '', apiKey: 'k' });
        expect([r.llmApiKey, r.sent]).toEqual(['', 'k']);
    });

    it('M3 external embedding, separate AI curation server: key copied', () => {
        const r = run({ embeddingProvider: 'openai-compatible', enableAICuration: true, llmUrl: 'http://llm:8080', apiKey: 'k' });
        expect([r.llmApiKey, r.sent]).toEqual(['k', 'k']);
    });

    it('M4 built-in embedding, separate AI curation server: key copied', () => {
        const r = run({ embeddingProvider: 'wasm', enableAICuration: true, llmUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' });
        expect([r.llmApiKey, r.sent]).toEqual(['k', 'k']);
    });

    it('M5 built-in embedding, shared server: reuses the key', () => {
        const r = run({ embeddingProvider: 'wasm', enableAICuration: true, llmUrl: '', apiKey: 'k' });
        expect([r.llmApiKey, r.sent]).toEqual(['', 'k']);
    });

    it('M6 no key: nothing to copy', () => {
        const r = run({ llmUrl: 'http://llm:8080', apiKey: '' });
        expect([r.llmApiKey, r.sent]).toEqual(['', '']);
    });

    it('M7 an existing llmApiKey is kept (trimmed) and never re-migrated', () => {
        expect(run({ llmUrl: 'http://llm:8080', apiKey: 'k', llmApiKey: '' })).toMatchObject({ llmApiKey: '', sent: '' });
        expect(run({ llmUrl: 'http://llm:8080', apiKey: 'k', llmApiKey: ' own ' })).toMatchObject({ llmApiKey: 'own', sent: 'own' });
    });

    it('M8 fresh install', () => {
        expect(run(undefined)).toMatchObject({ llmApiKey: '', sent: '' });
    });

    it('M9 a null apiKey loads as no key instead of throwing', () => {
        expect(run({ llmUrl: 'http://llm:8080', apiKey: null })).toMatchObject({ llmApiKey: '', apiKey: '', sent: '' });
    });

    it('M9b a numeric apiKey stays the key it was sent as', () => {
        expect(run({ llmUrl: 'http://llm:8080', apiKey: 12345 })).toMatchObject({ llmApiKey: '12345', apiKey: '12345', sent: '12345' });
    });

    it('M10 pre-1.6 data.json without llmUrl reuses the key', () => {
        expect(run({ apiKey: 'k' })).toMatchObject({ llmApiKey: '', sent: 'k' });
    });

    it('M11 a null llmApiKey is treated as set-but-empty', () => {
        expect(run({ llmUrl: 'http://llm:8080', apiKey: 'k', llmApiKey: null })).toMatchObject({ llmApiKey: '', sent: '' });
    });

    it('M12 settings that are not an object fall back to defaults', () => {
        for (const raw of [null, [], 'x']) expect(run(raw)).toMatchObject({ llmApiKey: '', sent: '' });
    });

    it('a migrated result loaded again stays the same', () => {
        const first = run({ embeddingProvider: 'openai-compatible', enableAICuration: true, llmUrl: 'http://llm:8080', apiKey: 'k' });
        const again = run({ ...first.merged });
        expect([again.llmApiKey, again.sent]).toEqual(['k', 'k']);
    });

    it('marks Onboarding due only for a new install (042 D1)', () => {
        for (const raw of [null, undefined, 'x', []]) {
            expect(mergeSettings(raw, DEFAULT_SETTINGS).onboardingDone).toBe(false);
        }
        expect(mergeSettings({}, DEFAULT_SETTINGS).onboardingDone).toBe(true);
        expect(mergeSettings({ ollamaUrl: 'http://x' }, DEFAULT_SETTINGS).onboardingDone).toBe(true);
        expect(mergeSettings({ onboardingDone: false }, DEFAULT_SETTINGS).onboardingDone).toBe(false);
        expect(mergeSettings({ onboardingDone: 'yes' }, DEFAULT_SETTINGS).onboardingDone).toBe(true);
    });
});
