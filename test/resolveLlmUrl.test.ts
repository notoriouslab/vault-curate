import { describe, it, expect } from 'vitest';
import { resolveLlmUrl } from '../src/utils/resolveLlmUrl';

describe('resolveLlmUrl', () => {
    it('falls back to the main URL when llmUrl is empty (case 1)', () => {
        expect(resolveLlmUrl('', 'http://a:1')).toBe('http://a:1');
    });

    it('treats whitespace-only llmUrl as unset (case 2)', () => {
        expect(resolveLlmUrl('  ', 'http://a:1')).toBe('http://a:1');
    });

    it('uses llmUrl when set (case 3)', () => {
        expect(resolveLlmUrl('http://b:8080', 'http://a:1')).toBe('http://b:8080');
    });

    it('strips trailing slashes, matching checkLLMReachable normalization (case 4)', () => {
        expect(resolveLlmUrl('http://b:8080/', 'http://a:1')).toBe('http://b:8080');
        expect(resolveLlmUrl('http://b:8080//', 'http://a:1')).toBe('http://b:8080');
    });

    it('tolerates undefined llmUrl (settings saved before the field existed)', () => {
        expect(resolveLlmUrl(undefined, 'http://a:1')).toBe('http://a:1');
    });

    it('trims surrounding whitespace from a set llmUrl', () => {
        expect(resolveLlmUrl(' http://b:8080 ', 'http://a:1')).toBe('http://b:8080');
    });
});
