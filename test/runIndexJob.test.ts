import { describe, it, expect, vi } from 'vitest';
import { runIndexJob } from '../src/indexer/runIndexJob';
import type { IndexJobReport } from '../src/indexer/runIndexJob';

function spyReport(): IndexJobReport & {
    busy: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
    log: ReturnType<typeof vi.fn>;
} {
    return { busy: vi.fn(), failed: vi.fn(), log: vi.fn() } as never;
}

describe('runIndexJob', () => {
    it('reports a failing job instead of leaving the caller hanging', async () => {
        const host = { indexing: false };
        const report = spyReport();
        const err = new Error('Ollama embed 404: {"error":"model \\"x\\" not found"}');

        await runIndexJob(host, () => Promise.reject(err), report);

        expect(report.failed).toHaveBeenCalledTimes(1);
        expect(report.failed.mock.calls[0][0]).toContain('404');
        expect(report.log).toHaveBeenCalledTimes(1);
        expect(host.indexing).toBe(false);
    });

    it('stays quiet and releases the lock on success', async () => {
        const host = { indexing: false };
        const report = spyReport();

        await runIndexJob(host, () => Promise.resolve(), report);

        expect(report.failed).toHaveBeenCalledTimes(0);
        expect(report.log).toHaveBeenCalledTimes(0);
        expect(host.indexing).toBe(false);
    });

    it('refuses to start a second job while one is running', async () => {
        const host = { indexing: true };
        const report = spyReport();
        const job = vi.fn(() => Promise.resolve());

        await runIndexJob(host, job, report);

        expect(report.busy).toHaveBeenCalledTimes(1);
        expect(job).toHaveBeenCalledTimes(0);
        expect(host.indexing).toBe(true);
    });

    it('reports a non-Error rejection as its string form', async () => {
        const host = { indexing: false };
        const report = spyReport();

        await runIndexJob(host, () => Promise.reject('boom'), report);

        expect(report.failed).toHaveBeenCalledWith('boom');
    });

    it('truncates an overlong failure message', async () => {
        const host = { indexing: false };
        const report = spyReport();

        await runIndexJob(host, () => Promise.reject(new Error('x'.repeat(300))), report);

        const msg = report.failed.mock.calls[0][0] as string;
        expect(msg).toHaveLength(201);
        expect(msg.endsWith('…')).toBe(true);
    });
});
