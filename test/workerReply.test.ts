import { describe, it, expect } from 'vitest';
import { errorReply } from '../src/workers/workerReply';

describe('errorReply', () => {
    it('routes an embed failure to its result slot', () => {
        expect(errorReply({ type: 'embed', id: 7 }, 'boom'))
            .toEqual({ type: 'result', id: 7, vectors: null, error: 'boom' });
    });

    it('routes a split failure to its split-result slot, not init-error', () => {
        expect(errorReply({ type: 'split', id: 9 }, 'boom'))
            .toEqual({ type: 'split-result', id: 9, chunks: null, error: 'boom' });
    });

    it('treats any other failure as an init failure', () => {
        expect(errorReply({ type: 'init' }, 'boom', 'stack'))
            .toEqual({ type: 'init-error', message: 'boom', stack: 'stack' });
    });
});
