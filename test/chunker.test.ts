import { describe, it, expect } from 'vitest';
import { splitChunks } from '../src/indexer/chunker';

describe('splitChunks', () => {
    const settings = { chunkSize: 10, chunkOverlap: 3 };

    it('returns single chunk with title prefix when body shorter than size', () => {
        const chunks = splitChunks('hello', '小明筆記', settings);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual({ content: '小明筆記\nhello', chunkIndex: 0 });
    });

    it('splits long body into overlapping windows', () => {
        const body = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars
        const chunks = splitChunks(body, 'T', { chunkSize: 10, chunkOverlap: 3 });
        // step = 7, slices: [0..10), [7..17), [14..24), [21..26)
        expect(chunks.map(c => c.content)).toEqual([
            'T\nabcdefghij',
            'T\nhijklmnopq',
            'T\nopqrstuvwx',
            'T\nvwxyz',
        ]);
        expect(chunks.map(c => c.chunkIndex)).toEqual([0, 1, 2, 3]);
    });

    it('assigns 0-based monotonic chunkIndex', () => {
        const body = 'x'.repeat(50);
        const chunks = splitChunks(body, 't', { chunkSize: 5, chunkOverlap: 1 });
        for (let i = 0; i < chunks.length; i++) {
            expect(chunks[i].chunkIndex).toBe(i);
        }
    });

    it('handles whitespace-only body → single title-only chunk', () => {
        const chunks = splitChunks('   \n  ', 'Title', settings);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[0].content).toBe('Title');
    });

    it('treats overlap >= size as 0 (defensive)', () => {
        const chunks = splitChunks('abcdefghij', 't', { chunkSize: 5, chunkOverlap: 10 });
        // step falls back to size (5), slices: [0..5), [5..10)
        expect(chunks.map(c => c.content)).toEqual([
            't\nabcde',
            't\nfghij',
        ]);
    });

    it('omits title prefix newline when title is empty', () => {
        const chunks = splitChunks('hello', '', settings);
        expect(chunks[0].content).toBe('hello');
    });

    it('trims leading/trailing whitespace from body before splitting', () => {
        const chunks = splitChunks('  hello  ', 't', { chunkSize: 100, chunkOverlap: 0 });
        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toBe('t\nhello');
    });
});
