// 013 D6: management modal for dismissed suggestions — the single place a
// judgment can be reviewed and reversed (假設 #95/#97). Pairs and notes are
// two sections, newest dismissal first; restoring deletes the entry so the
// pair/note may reappear in future suggestions.

import { App, Keymap, Modal, Notice, TFile } from "obsidian";
import type { PaneType } from "obsidian";
import type VaultSearchPlugin from "../main";
import { unpairKey } from "../utils/pairKey";
import { t } from "../i18n";

export class DismissedModal extends Modal {
    constructor(
        app: App,
        private plugin: VaultSearchPlugin,
        /** Fires after every restore so the Settings row's count stays live. */
        private onChanged: () => void,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: t.dismissedHeading });
        this.renderSections(contentEl.createDiv());
    }

    private renderSections(root: HTMLElement) {
        root.empty();
        const s = this.plugin.settings;
        const pairEntries = Object.entries(s.dismissedPairs).sort((a, b) => b[1] - a[1]);
        const noteEntries = Object.entries(s.dismissedNotes).sort((a, b) => b[1] - a[1]);

        if (pairEntries.length === 0 && noteEntries.length === 0) {
            root.createEl("p", { text: t.dismissedEmpty, cls: "setting-item-description" });
            return;
        }

        // Dogfood feedback (2026-07-29): a bare path string leaves the user
        // hunting for the original note — each path is a click-to-open link,
        // plus a copy button per row as the fallback for stale paths.
        const addRow = (parent: HTMLElement, paths: string[], restore: () => void) => {
            const row = parent.createDiv({ cls: "vault-curate-dismissed-row" });
            const labelEl = row.createDiv({ cls: "vault-curate-dismissed-label" });
            paths.forEach((p, i) => {
                if (i > 0) labelEl.createSpan({ text: " ↔ " });
                const link = labelEl.createEl("a", {
                    text: p,
                    cls: "vault-curate-dismissed-link",
                    attr: { title: t.dismissedOpenTooltip },
                });
                link.addEventListener("click", (e) => {
                    e.preventDefault();
                    this.openPath(p, Keymap.isModEvent(e));
                });
            });
            const copyBtn = row.createEl("button", {
                text: "⧉",
                cls: "vault-curate-dismissed-copy",
                attr: { "aria-label": t.dismissedCopyTooltip, title: t.dismissedCopyTooltip },
            });
            copyBtn.addEventListener("click", () => {
                void navigator.clipboard.writeText(paths.join(" ↔ "))
                    .then(() => new Notice(t.dismissedCopied));
            });
            const btn = row.createEl("button", { text: t.dismissedRestore });
            btn.addEventListener("click", () => {
                restore();
                void this.plugin.saveSettings();
                this.onChanged();
                this.renderSections(root);
            });
        };

        if (pairEntries.length > 0) {
            root.createEl("h4", { text: t.dismissedPairsSection });
            for (const [key] of pairEntries) {
                const [a, b] = unpairKey(key);
                addRow(root, [a, b], () => { delete this.plugin.settings.dismissedPairs[key]; });
            }
        }
        if (noteEntries.length > 0) {
            root.createEl("h4", { text: t.dismissedNotesSection });
            for (const [path] of noteEntries) {
                addRow(root, [path], () => { delete this.plugin.settings.dismissedNotes[path]; });
            }
        }
    }

    /** Open the note behind a dismissed entry. Stale paths (renamed outside
     *  the maintenance hooks, or deleted) get a Notice instead of a silent
     *  no-op; the copy button still works for manual searching. */
    private openPath(path: string, paneType: PaneType | boolean = false) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.close();
            void this.app.workspace.getLeaf(paneType).openFile(file);
        } else {
            new Notice(t.dismissedFileMissing);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
