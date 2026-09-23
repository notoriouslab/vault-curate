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
}
