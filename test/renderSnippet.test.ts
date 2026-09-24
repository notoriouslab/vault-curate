import { describe, it, expect } from 'vitest';
import { renderSnippet } from '../src/utils';
import type { SearchSnippet } from '../src/types';

const snippet = (text: string, ranges: Array<[number, number]>): SearchSnippet => ({
    text, ranges, source: 'bm25', anchor: text, chunkIndex: 0, chunkCount: 1, anchorRatio: 0,
});

describe('renderSnippet', () => {
    it('wraps each highlighted range in <mark> and keeps the text in order', () => {
        const host = document.createElement('div');
        renderSnippet(host, snippet('後段提到登山裝備要帶頭燈', [[4, 8], [10, 12]]));
        const el = host.querySelector('.vault-curate-snippet')!;
        expect(el.textContent).toBe('後段提到登山裝備要帶頭燈');
        expect(Array.from(el.querySelectorAll('mark')).map((m) => m.textContent)).toEqual(['登山裝備', '頭燈']);
    });

    it('renders plain text when there is nothing to highlight', () => {
        const host = document.createElement('div');
        renderSnippet(host, snippet('<b>不是標記</b>', []));
        const el = host.querySelector('.vault-curate-snippet')!;
        expect(el.querySelectorAll('mark')).toHaveLength(0);
        expect(el.querySelector('b')).toBeNull();
        expect(el.textContent).toBe('<b>不是標記</b>');
    });
});
