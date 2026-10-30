import { describe, it, expect } from 'vitest';
import { fillModelSelect } from '../src/ui/modelSelect';
import type { ModelSelectLabels } from '../src/ui/modelSelect';
import type { OllamaModel } from '../src/utils';

const LABELS: ModelSelectLabels = {
    placeholder: 'PLACEHOLDER',
    embeddingGroup: 'EMB_GROUP',
    otherGroup: 'OTHER_GROUP',
    notInstalled: 'NOT_INSTALLED',
};

function model(name: string, kind: 'embedding' | 'other', sizeGB = 0): OllamaModel {
    return { name, sizeGB, isEmbedding: kind === 'embedding', kind, source: 'capabilities' };
}

function newSelect(): HTMLSelectElement {
    return document.createElement('select');
}

function groups(select: HTMLSelectElement): HTMLOptGroupElement[] {
    return Array.from(select.querySelectorAll('optgroup'));
}

describe('fillModelSelect', () => {
    const models = [
        model('bge-m3:latest', 'embedding', 1.15),
        model('qwen3-embedding:0.6b', 'embedding', 0.64),
        model('qwen3.8:27b-mlx', 'other', 18.17),
    ];

    it('puts embedding models in the first group when primary is embedding', () => {
        const select = newSelect();
        fillModelSelect(select, models, 'embedding', '', LABELS);
        const gs = groups(select);
        expect(gs).toHaveLength(2);
        expect(gs[0].label).toBe('EMB_GROUP');
        expect(gs[0].querySelectorAll('option')).toHaveLength(2);
        expect(gs[1].label).toBe('OTHER_GROUP');
        expect(gs[1].querySelectorAll('option')).toHaveLength(1);
    });

    it('puts non-embedding models in the first group when primary is other', () => {
        const select = newSelect();
        fillModelSelect(select, models, 'other', '', LABELS);
        const gs = groups(select);
        expect(gs).toHaveLength(2);
        expect(gs[0].label).toBe('OTHER_GROUP');
        const first = Array.from(gs[0].querySelectorAll('option'));
        expect(first).toHaveLength(1);
        expect(first[0].value).toBe('qwen3.8:27b-mlx');
        expect(gs[1].label).toBe('EMB_GROUP');
    });

    it('does not render an empty group', () => {
        const select = newSelect();
        const embOnly = models.filter((m) => m.kind === 'embedding');
        fillModelSelect(select, embOnly, 'embedding', '', LABELS);
        expect(groups(select)).toHaveLength(1);
    });

    it('keeps a configured model that the server does not list, and reports it missing', () => {
        const select = newSelect();
        const result = fillModelSelect(select, models, 'embedding', 'ghost-model', LABELS);
        const first = groups(select)[0].querySelectorAll('option')[0];
        expect(first.textContent).toBe('ghost-model (NOT_INSTALLED)');
        expect(first.value).toBe('ghost-model');
        expect(select.value).toBe('ghost-model');
        expect(result.missing).toBe(true);
    });

    it('moves models without listed JSON support into a last group (issue #19)', () => {
        const select = newSelect();
        const withJson = [
            ...models,
            { ...model('scaledown/summarize', 'other'), jsonOutput: false },
            { ...model('openai/gpt-4o-mini', 'other'), jsonOutput: true },
        ];
        const result = fillModelSelect(select, withJson, 'other', 'scaledown/summarize', { ...LABELS, noJsonGroup: 'NO_JSON' });
        const gs = groups(select);
        expect(gs.map((g) => g.label)).toEqual(['OTHER_GROUP', 'EMB_GROUP', 'NO_JSON']);
        expect(Array.from(gs[0].querySelectorAll('option')).map((o) => o.value)).toEqual(['qwen3.8:27b-mlx', 'openai/gpt-4o-mini']);
        expect(Array.from(gs[2].querySelectorAll('option')).map((o) => o.value)).toEqual(['scaledown/summarize']);
        expect(select.value).toBe('scaledown/summarize');
        expect(result.missing).toBe(false);
    });

    it('keeps jsonOutput: false models in their kind group without noJsonGroup', () => {
        const select = newSelect();
        fillModelSelect(select, [{ ...model('scaledown/summarize', 'other'), jsonOutput: false }], 'other', '', LABELS);
        expect(groups(select).map((g) => g.label)).toEqual(['OTHER_GROUP']);
    });

    it('selects a configured model that the server does list', () => {
        const select = newSelect();
        const result = fillModelSelect(select, models, 'embedding', 'bge-m3:latest', LABELS);
        expect(result.missing).toBe(false);
        expect(select.value).toBe('bge-m3:latest');
    });
});
