/**
 * 015 Task 4: mobile index gate semantics.
 *   - 驗證 5（G1 稽核 C1）：失敗不快取——重試真的重新載入
 *   - 驗證 6（紅隊 C3）：深層讀取例外 → invalidate() 收斂（dispose + 清閘 + failed）
 *   - 尺寸防線：拒載時不呼叫 openStore；雙側邊界在 indexLoadDecision 測
 */
import { describe, it, expect, vi } from 'vitest';
import { MobileIndexGate } from '../src/mobile/indexGate';
import { indexLoadDecision, MOBILE_INDEX_MAX_BYTES } from '../src/utils/indexLoadDecision';

const mkStore = () => ({ dispose: vi.fn(async () => {}) });

describe('indexLoadDecision（尺寸防線純函式）', () => {
    it('雙側邊界：299MB → load、301MB → too-large；恰在閾值 → load', () => {
        expect(indexLoadDecision(299 * 1024 * 1024)).toBe('load');
        expect(indexLoadDecision(MOBILE_INDEX_MAX_BYTES)).toBe('load');
        expect(indexLoadDecision(301 * 1024 * 1024)).toBe('too-large');
    });
    it('未知大小（stat 不可信）樂觀放行', () => {
        expect(indexLoadDecision(null)).toBe('load');
        expect(indexLoadDecision(0)).toBe('load');
        expect(indexLoadDecision(-1)).toBe('load');
    });
});

describe('MobileIndexGate（015 Task 4）', () => {
    it('成功快取：並發與後續呼叫共用同一次載入', async () => {
        const store = mkStore();
        const openStore = vi.fn(async () => store);
        const gate = new MobileIndexGate({ statSize: async () => 1024, openStore });
        const [a, b] = await Promise.all([gate.ensureLoaded(), gate.ensureLoaded()]);
        const c = await gate.ensureLoaded();
        expect(a).toBe(store); expect(b).toBe(store); expect(c).toBe(store);
        expect(openStore).toHaveBeenCalledTimes(1);
        expect(gate.state).toBe('ready');
    });

    it('驗證 5：失敗不快取——第一次 throw、第二次成功 → 第二次呼叫 resolve', async () => {
        const store = mkStore();
        const openStore = vi.fn()
            .mockRejectedValueOnce(new Error('torn iCloud bytes'))
            .mockResolvedValueOnce(store);
        const gate = new MobileIndexGate({ statSize: async () => 1024, openStore });
        await expect(gate.ensureLoaded()).rejects.toThrow('torn iCloud bytes');
        expect(gate.state).toBe('failed');
        await expect(gate.ensureLoaded()).resolves.toBe(store); // 重試真的重載
        expect(openStore).toHaveBeenCalledTimes(2);
        expect(gate.state).toBe('ready');
    });

    it('驗證 6：invalidate() → dispose 被呼叫、閘已清（下次重新載入）、狀態 failed', async () => {
        const store1 = mkStore();
        const store2 = mkStore();
        const openStore = vi.fn()
            .mockResolvedValueOnce(store1)
            .mockResolvedValueOnce(store2);
        const gate = new MobileIndexGate({ statSize: async () => 1024, openStore });
        await gate.ensureLoaded();
        await gate.invalidate();
        expect(store1.dispose).toHaveBeenCalledTimes(1);
        expect(gate.state).toBe('failed');
        await expect(gate.ensureLoaded()).resolves.toBe(store2); // 深讀炸掉後可恢復
        expect(openStore).toHaveBeenCalledTimes(2);
    });

    it('尺寸防線：too-large 時 reject 且 openStore 從未被呼叫、記下 MB 數', async () => {
        const openStore = vi.fn(async () => mkStore());
        const gate = new MobileIndexGate({
            statSize: async () => 400 * 1024 * 1024,
            openStore,
        });
        await expect(gate.ensureLoaded()).rejects.toThrow('too large');
        expect(gate.state).toBe('too-large');
        expect(gate.lastTooLargeMb).toBe(400);
        expect(openStore).not.toHaveBeenCalled();
    });

    it('慢載入通知：超過 slowLoadMs 才觸發 onSlowLoad，快速完成不觸發', async () => {
        vi.useFakeTimers();
        try {
            const onSlowLoad = vi.fn();
            let release!: (s: ReturnType<typeof mkStore>) => void;
            const gate = new MobileIndexGate({
                statSize: async () => 1024,
                openStore: () => new Promise((res) => { release = res; }),
                onSlowLoad,
                slowLoadMs: 3000,
            });
            const p = gate.ensureLoaded();
            await vi.advanceTimersByTimeAsync(3100);
            expect(onSlowLoad).toHaveBeenCalledTimes(1);
            release(mkStore());
            await p;
            expect(gate.state).toBe('ready');

            // 對照：快速完成不彈
            const onSlowLoad2 = vi.fn();
            const gate2 = new MobileIndexGate({
                statSize: async () => 1024,
                openStore: async () => mkStore(),
                onSlowLoad: onSlowLoad2,
                slowLoadMs: 3000,
            });
            await gate2.ensureLoaded();
            await vi.advanceTimersByTimeAsync(5000);
            expect(onSlowLoad2).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
