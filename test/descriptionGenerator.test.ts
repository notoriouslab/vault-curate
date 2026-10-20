import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { DescriptionGenerator } from '../src/description-generator';

function makeFile(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.basename = path.replace(/\.md$/, '');
    return f;
}

function makeGenerator(llmModel = 'gemma3:4b') {
    const plugin = {
        settings: { ollamaUrl: 'http://localhost:11434', llmUrl: '', llmModel, apiFormat: 'ollama', apiKey: '' },
        app: {
            vault: { cachedRead: async () => 'body text' },
            metadataCache: { getFileCache: () => null },
            fileManager: { processFrontMatter: async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => fn({}) },
        },
        recordSelfWrite: () => {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gen = new DescriptionGenerator(plugin as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = gen as any;
    vi.spyOn(g, 'llmReachable').mockResolvedValue(true);
    return { gen, g };
}

const empty = { ok: 0, failed: 0, okPaths: new Set<string>() };

describe('generateForFiles result (040 D6)', () => {
    it('returns an empty result for an empty list', async () => {
        const { gen } = makeGenerator();
        expect(await gen.generateForFiles([])).toEqual(empty);
    });

    it('returns an empty result when no model is set', async () => {
        const { gen } = makeGenerator('');
        expect(await gen.generateForFiles([makeFile('a.md')])).toEqual(empty);
    });

    it('returns an empty result when the endpoint is unreachable', async () => {
        const { gen, g } = makeGenerator();
        g.llmReachable.mockResolvedValue(false);
        expect(await gen.generateForFiles([makeFile('a.md')])).toEqual(empty);
    });

    it('lists only the notes that succeeded', async () => {
        const { gen, g } = makeGenerator();
        vi.spyOn(g, 'callLLM').mockImplementation(async (_u: unknown, _m: unknown, title: unknown) => {
            if (title === 'bad') throw new Error('LLM down');
            return { description: 'Alpha covers the plan. It ends well.' };
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const res = await gen.generateForFiles([makeFile('good.md'), makeFile('bad.md')]);
        expect(res.ok).toBe(1);
        expect(res.failed).toBe(1);
        expect([...res.okPaths]).toEqual(['good.md']);
    });
});
