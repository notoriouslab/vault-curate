// Purple-edge promotion confirmation modal (010 D2, layout reworked after
// dogfood 2026-07-23) — pairs are GROUPED BY SOURCE NOTE: on a real canvas
// most purple edges share the graph's center, so repeating "center ↔ X"
// per row ate the whole width and truncated exactly the half that
// distinguishes the rows (主公 screenshot). The group header names the
// source once; each row spends its full width on the counterpart note
// (title line + muted folder line). Cmd/Ctrl+hover on any note name opens
// the native Page Preview (same hover-link source as Search/Discover,
// v1.0.3). Checkboxes default UNCHECKED: every wikilink written is one
// the user personally ticked (判定動作).

import { App, Modal, type HoverPopover } from "obsidian";
import type { PurplePair } from "../canvas/promote";
import { pairKey } from "../canvas/promote";
import { t } from "../i18n";

function basename(path: string): string {
    const file = path.slice(path.lastIndexOf("/") + 1);
    return file.endsWith(".md") ? file.slice(0, -3) : file;
}

function folderOf(path: string): string {
    const idx = path.lastIndexOf("/");
    return idx === -1 ? "/" : path.slice(0, idx);
}

export class PromoteModal extends Modal {
    private selected = new Set<string>();
    /** Makes this a structural HoverParent for the hover-link trigger —
     *  Page Preview assigns the popover here. */
    hoverPopover: HoverPopover | null = null;

    constructor(
        app: App,
        private pairs: PurplePair[],
        private onApply: (chosen: PurplePair[]) => void,
    ) {
        super(app);
    }

    /** Cmd/Ctrl+hover → native Page Preview (gated by the
     *  registerHoverLinkSource defaultMod:true in main.ts). */
    private attachHoverPreview(el: HTMLElement, path: string) {
        el.addEventListener("mouseover", (event) => {
            this.app.workspace.trigger("hover-link", {
                event,
                source: "vault-curate",
                hoverParent: this,
                targetEl: el,
                linktext: path,
                sourcePath: path,
            });
        });
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: t.promoteTitle });
        contentEl.createEl("p", {
            text: t.promoteHint,
            cls: "setting-item-description",
        });

        const list = contentEl.createDiv({ cls: "vault-curate-promote-list" });
        const btnRow = contentEl.createDiv({ cls: "vault-curate-modal-btnrow" });
        const countEl = btnRow.createEl("span", {
            text: t.promoteSelectedCount(0),
            cls: "vault-curate-promote-count",
        });
        const cancelBtn = btnRow.createEl("button", { text: t.promoteCancel });
        const applyBtn = btnRow.createEl("button", {
            text: t.promoteApply,
            cls: "mod-cta",
        });
        applyBtn.disabled = true;

        const refresh = () => {
            countEl.setText(t.promoteSelectedCount(this.selected.size));
            applyBtn.disabled = this.selected.size === 0;
        };

        const groups = new Map<string, PurplePair[]>();
        for (const pair of this.pairs) {
            const group = groups.get(pair.from);
            if (group) group.push(pair);
            else groups.set(pair.from, [pair]);
        }

        for (const [from, pairs] of groups) {
            const header = list.createDiv({ cls: "vault-curate-promote-group" });
            const headerName = header.createEl("span", {
                text: basename(from),
                cls: "vault-curate-promote-group-title",
            });
            header.createEl("span", {
                text: folderOf(from),
                cls: "vault-curate-promote-folder",
            });
            this.attachHoverPreview(headerName, from);

            for (const pair of pairs) {
                const key = pairKey(pair.from, pair.to);
                const row = list.createEl("label", { cls: "vault-curate-promote-row" });
                const cb = row.createEl("input", { type: "checkbox" });
                cb.addEventListener("change", () => {
                    if (cb.checked) this.selected.add(key);
                    else this.selected.delete(key);
                    refresh();
                });
                const nameBlock = row.createDiv({ cls: "vault-curate-promote-target" });
                nameBlock.createDiv({
                    text: basename(pair.to),
                    cls: "vault-curate-promote-pair",
                });
                nameBlock.createDiv({
                    text: folderOf(pair.to),
                    cls: "vault-curate-promote-folder",
                });
                this.attachHoverPreview(nameBlock, pair.to);
                if (pair.score !== undefined) {
                    row.createEl("span", {
                        text: pair.score.toFixed(2),
                        cls: "vault-curate-promote-score",
                    });
                }
            }
        }

        cancelBtn.addEventListener("click", () => this.close());
        applyBtn.addEventListener("click", () => {
            const chosen = this.pairs.filter((p) =>
                this.selected.has(pairKey(p.from, p.to)));
            this.close();
            if (chosen.length > 0) this.onApply(chosen);
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
