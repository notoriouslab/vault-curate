import { describe, it, expect } from 'vitest';
import { stripReasoningWrappers } from '../src/utils/stripReasoningWrappers';

describe('stripReasoningWrappers', () => {
    it('strips gpt-oss analysis+final channel wrapper (case 1)', () => {
        const input = '<|channel|>analysis<|message|>想想<|end|><|start|>assistant<|channel|>final<|message|>{"description":"x","tags":["a"]}';
        const out = stripReasoningWrappers(input);
        expect(JSON.parse(out)).toEqual({ description: 'x', tags: ['a'] });
    });

    it('strips Qwen <think> wrapper (case 2)', () => {
        const input = '<think>先想</think>{"description":"x","tags":["a"]}';
        const out = stripReasoningWrappers(input);
        expect(JSON.parse(out)).toEqual({ description: 'x', tags: ['a'] });
    });

    it('passes clean JSON through unchanged (case 3)', () => {
        const input = '{"description":"x","tags":["a","b"]}';
        expect(stripReasoningWrappers(input)).toBe(input);
    });

    it('removes trailing control tokens after the final channel (case 4)', () => {
        const input = '<|channel|>final<|message|>{"description":"x","tags":[]}<|return|>';
        const out = stripReasoningWrappers(input);
        expect(JSON.parse(out)).toEqual({ description: 'x', tags: [] });
    });

    it('throws on reasoning with no final answer — truncated output (case 5)', () => {
        const input = '<|channel|>analysis<|message|>還在想...';
        expect(() => stripReasoningWrappers(input)).toThrow(/no final answer/);
    });

    it('does not mangle clean JSON containing a literal </think> marker (case 6)', () => {
        const input = '{"description":"這篇講 </think> 標記","tags":[]}';
        expect(stripReasoningWrappers(input)).toBe(input);
    });

    it('takes the LAST final channel when reasoning echoes the format template (case 7)', () => {
        const input = '<|channel|>analysis<|message|>格式像 {"description":"...","tags":[...]} 這樣'
            + '<|end|><|start|>assistant<|channel|>final<|message|>{"description":"真答案","tags":["a"]}';
        const out = stripReasoningWrappers(input);
        expect(JSON.parse(out).description).toBe('真答案');
    });

    it('throws on truncated <think> with no closing tag', () => {
        expect(() => stripReasoningWrappers('<think>還在想')).toThrow(/no final answer/);
    });

    it('removes a trailing <|endoftext|> token', () => {
        const input = '<|channel|>final<|message|>{"description":"y"}<|endoftext|>';
        expect(JSON.parse(stripReasoningWrappers(input))).toEqual({ description: 'y' });
    });

    it('handles leading whitespace before the wrapper', () => {
        const input = '  \n<think>想</think>{"description":"x"}';
        expect(JSON.parse(stripReasoningWrappers(input))).toEqual({ description: 'x' });
    });
});
