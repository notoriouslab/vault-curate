// Settings tab — 032 dual track. One declarative definition list is the
// single source of truth: Obsidian 1.13+ takes it from
// getSettingDefinitions() and renders (and search-indexes) the rows itself,
// while older versions fall back to display(), which walks the same list
// through renderLegacy(). The rows themselves live in src/settings/.

import { App, Modal, Platform, PluginSettingTab, requireApiVersion } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type VaultSearchPlugin from "./main";
import { t } from "./i18n";
import type { SettingsContext } from "./settings/types";
import { renderLegacy } from "./settings/legacyRenderer";
import type { Cleanup } from "./settings/legacyRenderer";
import { buildDesktopDefinitions, buildMobileDefinitions } from "./settings/definitions";

export class VaultSearchSettingTab extends PluginSettingTab implements SettingsContext {
    plugin: VaultSearchPlugin;
    /** Teardown callbacks from the legacy-rendered rows. On 1.13 Obsidian
     *  calls each row's cleanup itself, so this stays empty there. */
    private cleanups: Cleanup[] = [];

    constructor(app: App, plugin: VaultSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        // 015 D5: mobile renders only what works there — no provider
        // picker, no rebuild/update, no AI curation, no chunk params.
        return Platform.isMobile ? buildMobileDefinitions(this) : buildDesktopDefinitions(this);
    }

    /** < 1.13 fallback: render the same definitions imperatively. */
    display(): void {
        this.runCleanups();
        this.containerEl.empty();
        renderLegacy(this.containerEl, this.getSettingDefinitions(), this.cleanups);
    }

    hide(): void {
        this.runCleanups();
        super.hide();
    }

    /** Re-render the whole tab (structure may have changed). */
    refresh(): void {
        if (requireApiVersion("1.13.0")) this.update();
        else this.display();
    }

    /** Re-evaluate visible/disabled predicates without a re-render. */
    refreshPredicates(): void {
        if (requireApiVersion("1.13.0")) this.refreshDomState();
        else this.display();
    }

    /** The backend became ready after the tab was built (init failure on
     *  desktop, lazy store load on mobile). Legacy has no in-place path:
     *  the user reopens the tab, as before. */
    notifyBackendReady(): void {
        if (requireApiVersion("1.13.0")) this.refreshDomState();
    }

    /** Show a destructive-action confirm modal; resolves to user's choice. */
    confirmProviderSwitch(): Promise<boolean> {
        return new Promise((resolve) => {
            const noteCount = this.plugin.store?.getAllBodyVecs().size ?? 0;
            new ProviderSwitchModal(this.app, noteCount, resolve).open();
        });
    }

    private runCleanups(): void {
        const pending = this.cleanups;
        this.cleanups = [];
        for (const cleanup of pending) cleanup();
    }
}


class ProviderSwitchModal extends Modal {
    private decided = false;

    constructor(
        app: App,
        private noteCount: number,
        private onResult: (confirmed: boolean) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(t.providerSwitchTitle);
        this.contentEl.createEl("p", { text: t.providerSwitchBody(this.noteCount) });

        const btnRow = this.contentEl.createDiv({ cls: "vault-curate-modal-btnrow" });

        const cancelBtn = btnRow.createEl("button", { text: t.providerSwitchCancel });
        cancelBtn.addEventListener("click", () => this.resolve(false));

        const confirmBtn = btnRow.createEl("button", { text: t.providerSwitchConfirm });
        confirmBtn.addClass("mod-warning");
        confirmBtn.addEventListener("click", () => this.resolve(true));

        // Esc handler — same path as button cancel. Backdrop click + X are
        // covered by onClose() so the promise resolves even when the user
        // dismisses without clicking a button.
        this.scope.register([], "Escape", () => this.resolve(false));
    }

    onClose(): void {
        // Backdrop / X dismissal arrives here without going through resolve().
        // Treat as cancel so the caller's promise never hangs and the dropdown
        // can revert to its prior value.
        if (!this.decided) this.onResult(false);
        this.contentEl.empty();
    }

    private resolve(confirmed: boolean): void {
        if (this.decided) return;
        this.decided = true;
        this.onResult(confirmed);
        this.close();
    }
}
