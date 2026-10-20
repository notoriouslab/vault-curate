import { describe, it, expect } from 'vitest';
import { buildLlmRequestBody } from '../src/utils';

const base = { llmModel: 'gemma3:4b', apiFormat: 'ollama' as const };

describe('buildLlmRequestBody (040 D2)', () => {
    it('keeps the Ollama body unchanged when no num_ctx is given', () => {
        const body = JSON.parse(buildLlmRequestBody(base, 'P'));
        expect(body).toEqual({
            model: 'gemma3:4b',
            messages: [{ role: 'user', content: 'P' }],
            stream: false,
            format: 'json',
            think: false,
        });
    });

    it('adds options.num_ctx for Ollama', () => {
        const body = JSON.parse(buildLlmRequestBody(base, 'P', { numCtx: 4096 }));
        expect(body.options).toEqual({ num_ctx: 4096 });
    });

    it('never sends num_ctx to OpenAI-compatible servers', () => {
        const body = JSON.parse(buildLlmRequestBody({ ...base, apiFormat: 'openai' }, 'P', { numCtx: 4096 }));
        expect(body.options).toBeUndefined();
        expect(body.response_format).toEqual({ type: 'json_object' });
    });
});
