import { describe, it, expect } from 'vitest';
import {
    effectiveChunkPolicy,
    chunkUpgradeState,
    parseChunkTarget,
    planChunkUpgrade,
    finalizeChunkUpgrade,
} from '../src/indexer/chunkPolicy';

const wasm = { chunkPolicy: 'tok512-v1' };
const external = {};
const chars = { chunkSize: 2000, chunkOverlap: 100 };

describe('effectiveChunkPolicy', () => {
    it('uses the provider policy when present', () => {
        expect(effectiveChunkPolicy(wasm, chars)).toBe('tok512-v1');
    });

    it('falls back to the char policy from settings', () => {
        expect(effectiveChunkPolicy(external, chars)).toBe('char2000-o100');
    });
});

describe('chunkUpgradeState', () => {
    it('is none when the stored policy matches', () => {
        expect(chunkUpgradeState('tok512-v1', wasm, chars)).toBe('none');
    });

    it('is stamp-only for an external provider on a pre-policy index', () => {
        expect(chunkUpgradeState(null, external, chars)).toBe('stamp-only');
    });

    it('is reembed for the built-in model on a pre-policy index', () => {
        expect(chunkUpgradeState(null, wasm, chars)).toBe('reembed');
    });

    it('is reembed when a char-policy index meets the built-in model', () => {
        expect(chunkUpgradeState('char2000-o100', wasm, chars)).toBe('reembed');
    });

    it('is reembed when an external user changed chunkSize', () => {
        expect(chunkUpgradeState('char2000-o100', external, { chunkSize: 1500, chunkOverlap: 100 })).toBe('reembed');
    });
});

describe('parseChunkTarget', () => {
    it('parses policy, start time and attempt', () => {
        expect(parseChunkTarget('tok512-v1@123#2')).toEqual({ policy: 'tok512-v1', startedAt: 123, attempt: 2 });
    });

    it('treats a missing attempt as 0', () => {
        expect(parseChunkTarget('tok512-v1@123')).toEqual({ policy: 'tok512-v1', startedAt: 123, attempt: 0 });
    });

    it('rejects garbage', () => {
        expect(parseChunkTarget('garbage')).toBeNull();
    });
});

describe('planChunkUpgrade', () => {
    it('starts a fresh target when none is stored', () => {
        expect(planChunkUpgrade(null, 'tok512-v1', 500))
            .toEqual({ target: 'tok512-v1@500#0', startedAt: 500, attempt: 0, rewrite: true });
    });

    it('keeps a matching target', () => {
        expect(planChunkUpgrade('tok512-v1@123#2', 'tok512-v1', 500))
            .toEqual({ target: 'tok512-v1@123#2', startedAt: 123, attempt: 2, rewrite: false });
    });

    it('restarts when the stored target is for another policy', () => {
        expect(planChunkUpgrade('tok511-v0@123#2', 'tok512-v1', 500))
            .toEqual({ target: 'tok512-v1@500#0', startedAt: 500, attempt: 0, rewrite: true });
    });

    it('restarts when the stored target is malformed', () => {
        expect(planChunkUpgrade('garbage', 'tok512-v1', 500).rewrite).toBe(true);
    });
});

describe('finalizeChunkUpgrade', () => {
    const base = { effective: 'tok512-v1', runStartMs: 900, resumable: true, providerLost: false };
    const none = { stampPolicy: false, deleteTarget: false, writeTarget: null, giveUp: false };

    it('(1) does nothing on a clean pass that is already stamped', () => {
        expect(finalizeChunkUpgrade({ ...base, failed: 0, storedPolicy: 'tok512-v1', target: null })).toEqual(none);
    });

    it('(2) stamps on a clean pass when the policy changed', () => {
        expect(finalizeChunkUpgrade({ ...base, failed: 0, storedPolicy: null, target: null }).stampPolicy).toBe(true);
    });

    it('(3) deletes the target on a clean pass', () => {
        const r = finalizeChunkUpgrade({
            ...base, failed: 0, storedPolicy: null,
            target: { policy: 'tok512-v1', startedAt: 1, attempt: 0 },
        });
        expect(r.deleteTarget).toBe(true);
    });

    it('(4) writes a first target when a failing pass had none', () => {
        expect(finalizeChunkUpgrade({ ...base, failed: 2, storedPolicy: null, target: null }))
            .toEqual({ stampPolicy: false, deleteTarget: false, writeTarget: 'tok512-v1@900#1', giveUp: false });
    });

    it('(5) bumps the attempt and keeps the start time', () => {
        expect(finalizeChunkUpgrade({
            ...base, failed: 2, storedPolicy: null,
            target: { policy: 'tok512-v1', startedAt: 100, attempt: 0 },
        })).toEqual({ stampPolicy: false, deleteTarget: false, writeTarget: 'tok512-v1@100#1', giveUp: false });
    });

    it('(6) gives up on the third failing pass', () => {
        expect(finalizeChunkUpgrade({
            ...base, failed: 2, storedPolicy: null,
            target: { policy: 'tok512-v1', startedAt: 100, attempt: 2 },
        })).toEqual({ stampPolicy: true, deleteTarget: true, writeTarget: null, giveUp: true });
    });

    it('(7) leaves ordinary failures alone when no upgrade is pending', () => {
        expect(finalizeChunkUpgrade({ ...base, failed: 2, storedPolicy: 'tok512-v1', target: null })).toEqual(none);
    });

    it('(8) treats a target for another policy as absent', () => {
        expect(finalizeChunkUpgrade({
            ...base, failed: 2, storedPolicy: null,
            target: { policy: 'tok511-v0', startedAt: 100, attempt: 2 },
        })).toEqual({ stampPolicy: false, deleteTarget: false, writeTarget: 'tok512-v1@900#1', giveUp: false });
    });

    it('(9) records nothing for a provider that cannot resume on its own', () => {
        expect(finalizeChunkUpgrade({ ...base, resumable: false, failed: 2, storedPolicy: null, target: null })).toEqual(none);
    });

    it('(10) keeps the attempt count when the pass lost its provider', () => {
        expect(finalizeChunkUpgrade({
            ...base, providerLost: true, failed: 5, storedPolicy: null,
            target: { policy: 'tok512-v1', startedAt: 100, attempt: 2 },
        })).toEqual({ stampPolicy: false, deleteTarget: false, writeTarget: 'tok512-v1@100#2', giveUp: false });
    });

    it('(11) starts at attempt 0 when a provider-lost pass had no target', () => {
        expect(finalizeChunkUpgrade({ ...base, providerLost: true, failed: 5, storedPolicy: null, target: null }).writeTarget)
            .toBe('tok512-v1@900#0');
    });
});
