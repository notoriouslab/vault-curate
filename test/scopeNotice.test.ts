import { describe, it, expect } from 'vitest';
import { shouldShowScopeNotice } from '../src/utils/scopeNotice';

describe('shouldShowScopeNotice', () => {
    it('shows once for a user still on Hot', () => {
        expect(shouldShowScopeNotice({ searchScope: 'hot', scopeNoticeShown: false })).toEqual({ show: true, markShown: true });
    });

    it('stays quiet for All but still records that it ran', () => {
        expect(shouldShowScopeNotice({ searchScope: 'all', scopeNoticeShown: false })).toEqual({ show: false, markShown: true });
    });

    it('never shows twice', () => {
        expect(shouldShowScopeNotice({ searchScope: 'hot', scopeNoticeShown: true })).toEqual({ show: false, markShown: false });
    });

    it('stays quiet for Cold (a deliberate choice) but records that it ran', () => {
        expect(shouldShowScopeNotice({ searchScope: 'cold', scopeNoticeShown: false })).toEqual({ show: false, markShown: true });
    });
});
