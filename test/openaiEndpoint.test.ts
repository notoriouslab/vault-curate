import { describe, it, expect } from 'vitest';
import { openaiEndpoint } from '../src/utils/openaiEndpoint';

describe('openaiEndpoint', () => {
    it('appends /v1 to a bare server root', () => {
        expect(openaiEndpoint('http://localhost:11434', 'models')).toBe('http://localhost:11434/v1/models');
    });

    it('does not double /v1 when the base already ends with it (issue #19)', () => {
        expect(openaiEndpoint('https://openrouter.ai/api/v1', 'models')).toBe('https://openrouter.ai/api/v1/models');
        expect(openaiEndpoint('https://openrouter.ai/api/v1', 'chat/completions'))
            .toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('handles trailing slashes on either form', () => {
        expect(openaiEndpoint('https://openrouter.ai/api/v1/', 'models')).toBe('https://openrouter.ai/api/v1/models');
        expect(openaiEndpoint('http://localhost:11434//', 'embeddings')).toBe('http://localhost:11434/v1/embeddings');
    });

    it('keeps a path prefix that is not /v1', () => {
        expect(openaiEndpoint('https://openrouter.ai/api', 'models')).toBe('https://openrouter.ai/api/v1/models');
        expect(openaiEndpoint('http://host/v1beta', 'models')).toBe('http://host/v1beta/v1/models');
    });

    it('tolerates a leading slash on the path', () => {
        expect(openaiEndpoint('http://a:1/v1', '/embeddings')).toBe('http://a:1/v1/embeddings');
    });
});
