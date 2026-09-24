/**
 * 034 D5: the search default moved from Hot to All, but settings are saved
 * whole on every load, so existing users have "hot" written down whether
 * they chose it or not. Tell a Hot user once how to change it instead of
 * silently rewriting their setting. `markShown` is true whenever the check
 * runs for the first time, so a user who later picks Hot is never nagged.
 */
export function shouldShowScopeNotice(s: {
    searchScope: "hot" | "all" | "cold";
    scopeNoticeShown: boolean;
}): { show: boolean; markShown: boolean } {
    if (s.scopeNoticeShown) return { show: false, markShown: false };
    return { show: s.searchScope === "hot", markShown: true };
}
