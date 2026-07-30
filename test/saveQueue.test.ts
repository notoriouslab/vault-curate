import { describe, it, expect } from 'vitest';
import { createWriteQueue } from '../src/utils/writeQueue';

describe('createWriteQueue', () => {
    it('runs jobs in call order', async () => {
        const queue = createWriteQueue();
        const calls: number[] = [];
        await Promise.all([
            queue(async () => { calls.push(1); }),
            queue(async () => { calls.push(2); }),
            queue(async () => { calls.push(3); }),
        ]);
        expect(calls).toEqual([1, 2, 3]);
    });

    it('never runs two jobs concurrently (second waits for the first to resolve)', async () => {
        const queue = createWriteQueue();
        let releaseFirst!: () => void;
        const gate = new Promise<void>((r) => { releaseFirst = r; });
        let firstDone = false;
        let secondStarted = false;

        const p1 = queue(async () => { await gate; firstDone = true; });
        const p2 = queue(async () => { secondStarted = true; });

        // Give the queue every chance to (wrongly) start job 2 early.
        await new Promise((r) => setTimeout(r, 10));
        expect(secondStarted).toBe(false);

        releaseFirst();
        await Promise.all([p1, p2]);
        expect(firstDone).toBe(true);
        expect(secondStarted).toBe(true);
    });

    it('a rejected job does not stall the queue', async () => {
        const queue = createWriteQueue();
        const calls: string[] = [];
        const p1 = queue(async () => { calls.push('a'); });
        const p2 = queue(async () => { throw new Error('boom'); });
        const p3 = queue(async () => { calls.push('c'); });
        await p1;
        await expect(p2).rejects.toThrow('boom');
        await p3;
        expect(calls).toEqual(['a', 'c']);
    });
});
