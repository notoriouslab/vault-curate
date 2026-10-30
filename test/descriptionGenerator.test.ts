import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { DescriptionGenerator } from '../src/description-generator';
import { t } from '../src/i18n';

function makeFile(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.basename = path.replace(/\.md$/, '');
    return f;
}

// fmOnDisk is a.md's frontmatter; every other note gets its own object, and
// the metadata cache and processFrontMatter see the same one per note.
function makeGenerator(llmModel = 'gemma3:4b', fmOnDisk: Record<string, unknown> = {}) {
    const fms = new Map<string, Record<string, unknown>>([['a.md', fmOnDisk]]);
    const fmOf = (f: TFile) => {
        if (!fms.has(f.path)) fms.set(f.path, {});
        return fms.get(f.path)!;
    };
    const plugin = {
        settings: { ollamaUrl: 'http://localhost:11434', llmUrl: '', llmModel, apiFormat: 'ollama', apiKey: '' },
        app: {
            vault: { cachedRead: async () => 'body text' },
            // A snapshot, like Obsidian's cache after each re-parse.
            metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: { ...fmOf(f) } }) },
            fileManager: { processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => fn(fmOf(f)) },
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

const empty = { ok: 0, failed: 0, skipped: 0, okPaths: new Set<string>() };

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

    it('puts the server reason in the batch summary (issue #19)', async () => {
        const { gen, g } = makeGenerator();
        vi.spyOn(g, 'callLLM').mockRejectedValue(new Error('LLM 402: Insufficient credits'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const done = vi.spyOn(t, 'descBatchDone');
        await gen.generateForFiles([makeFile('a.md')]);
        expect(done).toHaveBeenCalledWith(0, 1, '402: Insufficient credits');
        expect(t.descBatchDone(0, 1, '402: Insufficient credits')).toContain('402: Insufficient credits');
        done.mockRestore();
    });

    it('names the reason when the model only echoes the title', async () => {
        const { gen, g } = makeGenerator();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(g, 'callLLM').mockResolvedValue({ description: 'a' });
        const done = vi.spyOn(t, 'descBatchDone');
        await gen.generateForFiles([makeFile('a.md')]);
        expect(done).toHaveBeenCalledWith(0, 1, t.descReasonEchoTitle);
        done.mockRestore();
    });

    it('names the reason when the reply has no description', async () => {
        const { gen, g } = makeGenerator();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(g, 'callLLM').mockResolvedValue({ description: '  ' });
        const done = vi.spyOn(t, 'descBatchDone');
        await gen.generateForFiles([makeFile('a.md')]);
        expect(done).toHaveBeenCalledWith(0, 1, t.descReasonEmpty);
        done.mockRestore();
    });

    it('starts each batch without the previous batch reason', async () => {
        const { gen, g } = makeGenerator();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(g, 'callLLM').mockRejectedValueOnce(new Error('LLM 401: bad key'));
        await gen.generateForFiles([makeFile('a.md')]);
        g.callLLM.mockResolvedValue({ description: 'Alpha covers the plan. It ends well.' });
        const done = vi.spyOn(t, 'descBatchDone');
        await gen.generateForFiles([makeFile('b.md')]);
        expect(done).toHaveBeenCalledWith(1, 0, '');
        done.mockRestore();
    });
});

describe('batch write guard (040 review)', () => {
    const okLlm = async () => ({ description: 'Alpha covers the plan. It ends well.' });

    it('skips a note whose description changed while the batch ran', async () => {
        const fm: Record<string, unknown> = { description: 'Edited by hand meanwhile.' };
        const { gen, g } = makeGenerator('gemma3:4b', fm);
        vi.spyOn(g, 'callLLM').mockImplementation(okLlm);
        const res = await gen.generateForFiles([makeFile('a.md')], new Map([['a.md', 'old cut text']]));
        expect(fm.description).toBe('Edited by hand meanwhile.');
        expect(res.okPaths.size).toBe(0);
        expect(res.failed).toBe(0);
        expect(res.skipped).toBe(1);
    });

    it('writes when the description is still the one the batch picked', async () => {
        const fm: Record<string, unknown> = { description: 'old cut text' };
        const { gen, g } = makeGenerator('gemma3:4b', fm);
        vi.spyOn(g, 'callLLM').mockImplementation(okLlm);
        const res = await gen.generateForFiles([makeFile('a.md')], new Map([['a.md', 'old cut text']]));
        expect(fm.description).toBe('Alpha covers the plan. It ends well.');
        expect([...res.okPaths]).toEqual(['a.md']);
    });

    it('treats a missing and an empty description as the same pick', async () => {
        const fm: Record<string, unknown> = {};
        const { gen, g } = makeGenerator('gemma3:4b', fm);
        vi.spyOn(g, 'callLLM').mockImplementation(okLlm);
        await gen.generateForFiles([makeFile('a.md')], new Map([['a.md', '']]));
        expect(fm.description).toBe('Alpha covers the plan. It ends well.');
    });
});

describe('batch write guard timing (040 review)', () => {
    it('sees an edit made while the LLM call was running', async () => {
        const fm: Record<string, unknown> = { description: 'old cut text' };
        const { gen, g } = makeGenerator('gemma3:4b', fm);
        vi.spyOn(g, 'callLLM').mockImplementation(async () => {
            fm.description = 'Edited during the call.';
            return { description: 'Alpha covers the plan. It ends well.' };
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const write = vi.spyOn(g.plugin.app.fileManager, 'processFrontMatter');
        const res = await gen.generateForFiles([makeFile('a.md')], new Map([['a.md', 'old cut text']]));
        expect(fm.description).toBe('Edited during the call.');
        expect(res.skipped).toBe(1);
        // Skipped before processFrontMatter, which would re-serialize the YAML.
        expect(write).not.toHaveBeenCalled();
    });
});

describe('batch write guard backstop (040 review)', () => {
    it('still keeps the edit when the metadata cache has not caught up yet', async () => {
        const fm: Record<string, unknown> = { description: 'Edited on disk just now.' };
        const { gen, g } = makeGenerator('gemma3:4b', fm);
        // The cache still shows the value the batch picked.
        g.plugin.app.metadataCache.getFileCache = () => ({ frontmatter: { description: 'old cut text' } });
        vi.spyOn(g, 'callLLM').mockResolvedValue({ description: 'Alpha covers the plan. It ends well.' });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const res = await gen.generateForFiles([makeFile('a.md')], new Map([['a.md', 'old cut text']]));
        expect(fm.description).toBe('Edited on disk just now.');
        expect(res.skipped).toBe(1);
    });
});
