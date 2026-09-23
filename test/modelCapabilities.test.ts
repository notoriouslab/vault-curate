import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    classifyByCapabilities,
    classifyByHeuristic,
    resolveModelKind,
} from '../src/utils/modelCapabilities';

// Vitest runs with the repo root as cwd (see vitest.config.ts `include`).
function readFixture(name: string): unknown {
    return JSON.parse(readFileSync(`test/fixtures/ollama/${name}`, 'utf8'));
}

interface TagsFixture {
    models: Array<{ name: string; capabilities?: string[] }>;
}

describe('classifyByCapabilities — real /api/tags payload (Ollama 0.33.1)', () => {
    const tags = readFixture('tags_0.33.1.json') as TagsFixture;
    const byName = new Map(tags.models.map((m) => [m.name, m.capabilities]));

    it('classifies bge-m3:latest as embedding from capabilities', () => {
        const r = resolveModelKind('bge-m3:latest', byName.get('bge-m3:latest'));
        expect(r).toEqual({ kind: 'embedding', source: 'capabilities' });
    });

    it('classifies qwen3-embedding:0.6b as embedding from capabilities', () => {
        const r = resolveModelKind('qwen3-embedding:0.6b', byName.get('qwen3-embedding:0.6b'));
        expect(r).toEqual({ kind: 'embedding', source: 'capabilities' });
    });

    it('classifies qwen3.8:27b-mlx as other from capabilities', () => {
        const r = resolveModelKind('qwen3.8:27b-mlx', byName.get('qwen3.8:27b-mlx'));
        expect(r).toEqual({ kind: 'other', source: 'capabilities' });
    });
});

describe('classifyByCapabilities — /api/show payload', () => {
    it('treats embedding as present even alongside other capabilities', () => {
        const show = readFixture('show_qwen3-embedding.json') as { capabilities?: string[] };
        expect(show.capabilities).toEqual(['tools', 'thinking', 'embedding']);
        expect(classifyByCapabilities(show.capabilities)).toBe('embedding');
    });

    it('returns unknown when the field is absent (pre-0.30 servers)', () => {
        expect(classifyByCapabilities(undefined)).toBe('unknown');
        expect(classifyByCapabilities(null)).toBe('unknown');
    });

    it('returns other for an empty capability list (present but no embedding)', () => {
        expect(classifyByCapabilities([])).toBe('other');
    });
});

describe('resolveModelKind — layering', () => {
    it('falls back to the name heuristic when capabilities are missing', () => {
        expect(resolveModelKind('bge-m3:latest', undefined)).toEqual({
            kind: 'embedding',
            source: 'heuristic',
        });
        expect(resolveModelKind('qwen3:1.7b', undefined)).toEqual({
            kind: 'other',
            source: 'heuristic',
        });
    });

    it('prefers capabilities over the name heuristic', () => {
        expect(resolveModelKind('qwen3:1.7b', ['embedding'])).toEqual({
            kind: 'embedding',
            source: 'capabilities',
        });
    });
});

describe('classifyByHeuristic', () => {
    const embedding = [
        'bge-m3:latest',
        'quentinz/bge-small-zh-v1.5:latest',
        'all-minilm',
        'nomic-embed-text',
        'mxbai-embed-large',
        'snowflake-arctic-embed2',
    ];
    const other = ['qwen3:1.7b', 'llama3.2:3b', 'gemma3:4b'];

    it('recognises known embedding model names', () => {
        for (const name of embedding) {
            expect(classifyByHeuristic(name), name).toBe('embedding');
        }
    });

    it('does not misclassify generative model names', () => {
        for (const name of other) {
            expect(classifyByHeuristic(name), name).toBe('other');
        }
    });
});
