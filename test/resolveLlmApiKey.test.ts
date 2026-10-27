import { describe, it, expect } from 'vitest';
import { keyText, resolveLlmApiKey } from '../src/utils/resolveLlmApiKey';

describe('keyText', () => {
    it('trims strings and keeps finite numbers as text (041 D2)', () => {
        expect(keyText(' a ')).toBe('a');
        expect(keyText(12345)).toBe('12345');
        expect(keyText(0)).toBe('0');
    });

    it('treats anything else as no key', () => {
        for (const x of [NaN, Infinity, null, undefined, {}]) expect(keyText(x)).toBe('');
    });
});

describe('resolveLlmApiKey (041 D2)', () => {
    it('uses the AI curation key when set', () => {
        expect(resolveLlmApiKey({ llmApiKey: ' llm ', llmUrl: 'http://x', apiKey: 'emb' })).toBe('llm');
    });

    it('reuses the embedding key when AI curation shares the embedding server', () => {
        expect(resolveLlmApiKey({ llmApiKey: '', llmUrl: '', apiKey: ' emb ' })).toBe('emb');
        expect(resolveLlmApiKey({ llmApiKey: '', llmUrl: '   ', apiKey: ' emb ' })).toBe('emb');
    });

    it('sends no key to a separate server without its own key', () => {
        expect(resolveLlmApiKey({ llmApiKey: '', llmUrl: 'http://x', apiKey: 'emb' })).toBe('');
    });

    it('tolerates missing fields (test doubles, old data.json)', () => {
        expect(resolveLlmApiKey({ llmUrl: '', apiKey: 'emb' })).toBe('emb');
        expect(resolveLlmApiKey({})).toBe('');
    });

    it('tolerates null without throwing', () => {
        expect(resolveLlmApiKey({ llmApiKey: null, llmUrl: null, apiKey: null })).toBe('');
    });
});
