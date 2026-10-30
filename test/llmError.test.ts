import { describe, it, expect } from 'vitest';
import { apiErrorMessage, llmFailureReason } from '../src/utils/llmError';

describe('apiErrorMessage (issue #19)', () => {
    it('reads OpenAI / OpenRouter error.message', () => {
        const body = '{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402}}';
        expect(apiErrorMessage(body)).toBe('Insufficient credits. Add more using https://openrouter.ai/settings/credits');
    });

    it('reads Ollama error string, then message, then detail', () => {
        expect(apiErrorMessage('{"error":"model \\"x\\" not found"}')).toBe('model "x" not found');
        expect(apiErrorMessage('{"message":"bad key"}')).toBe('bad key');
        expect(apiErrorMessage('{"detail":"Not Found"}')).toBe('Not Found');
    });

    it('falls back to the raw text for non-JSON or unknown shapes', () => {
        expect(apiErrorMessage('<html>\n502 Bad Gateway\n</html>')).toBe('<html> 502 Bad Gateway </html>');
        expect(apiErrorMessage('{"error":{"code":500}}')).toBe('{"error":{"code":500}}');
        expect(apiErrorMessage('')).toBe('');
    });

    it('truncates long messages', () => {
        const out = apiErrorMessage(JSON.stringify({ error: { message: 'x'.repeat(500) } }));
        expect(out).toBe('x'.repeat(200) + '...');
    });
});

describe('llmFailureReason (issue #19)', () => {
    it('drops the LLM prefix requestLlmJson adds', () => {
        expect(llmFailureReason(new Error('LLM 402: Insufficient credits'))).toBe('402: Insufficient credits');
        expect(llmFailureReason(new Error('LLM timeout (120s)'))).toBe('timeout (120s)');
    });

    it('keeps other messages and handles non-Error values', () => {
        expect(llmFailureReason(new Error('Invalid cluster naming JSON'))).toBe('Invalid cluster naming JSON');
        expect(llmFailureReason('net::ERR_NAME_NOT_RESOLVED')).toBe('net::ERR_NAME_NOT_RESOLVED');
        expect(llmFailureReason(undefined)).toBe('');
    });

    it('caps the reason at 160 characters', () => {
        expect(llmFailureReason(new Error('y'.repeat(300)))).toBe('y'.repeat(160) + '...');
    });
});
