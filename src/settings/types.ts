import type { App } from "obsidian";
import type VaultSearchPlugin from "../main";

/** Capabilities the setting definitions need from the tab. Implemented by VaultSearchSettingTab. */
export interface SettingsContext {
    readonly app: App;
    readonly plugin: VaultSearchPlugin;
    /** Re-render the whole tab: 1.13 `update()`, legacy `display()`. */
    refresh(): void;
    /** Re-evaluate `visible`/`disabled` predicates only: 1.13 `refreshDomState()`, legacy `display()`. */
    refreshPredicates(): void;
    /** Destructive-action confirm (ProviderSwitchModal). */
    confirmProviderSwitch(): Promise<boolean>;
    /** The stats panel registers how to redraw itself (null on teardown). */
    setStatsRefresher(cb: (() => void) | null): void;
    /** Redraw only the stats panel (hotDays edits); never a full re-render,
     *  which would steal focus from the input being typed in. */
    refreshStats(): void;
    /** A row whose content depends on the server address (model lists,
     *  the endpoint probe) registers how to reload itself; returns the
     *  unregister function for the row's teardown. */
    onServerChange(cb: () => void): () => void;
    /** A server address was edited: reload those rows in place. Never a
     *  full re-render, which would steal focus from the address input. */
    serverChanged(): void;
    /** A row whose warning depends on another field (the http-with-key
     *  warning on the server rows) registers how to redraw it. */
    onWarningsChange(cb: () => void): () => void;
    /** A server or key field was typed in: redraw the warnings now. The
     *  model lists wait for serverChanged() when the field is left (042 D7). */
    warningsChanged(): void;
}
