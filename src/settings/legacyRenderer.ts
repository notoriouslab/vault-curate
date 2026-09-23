// Imperative renderer for the declarative setting definitions, used by
// display() on Obsidian < 1.13 (1.13+ renders the definitions itself).

import { Setting } from "obsidian";
import type {
    SettingDefinitionGroup,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroup,
} from "obsidian";

export type Cleanup = () => void;

function isVisible(visible: boolean | (() => boolean) | undefined): boolean {
    if (visible === undefined) return true;
    return typeof visible === "function" ? visible() : visible;
}

/** Render declarative items imperatively for Obsidian < 1.13 (display() fallback). */
export function renderLegacy(
    container: HTMLElement,
    items: SettingDefinitionItem[],
    cleanups: Cleanup[],
): void {
    for (const item of items) {
        if (!isVisible(item.visible)) continue;

        const type = (item as { type?: string }).type;

        if (type === "group") {
            const group = item as SettingDefinitionGroup;
            if (group.heading) {
                new Setting(container).setName(group.heading).setHeading();
            }
            renderLegacy(container, (group.items ?? []) as SettingDefinitionItem[], cleanups);
            continue;
        }

        if (type === "page") {
            const page = item as SettingDefinitionPage;
            const details = container.createEl("details", { cls: "vault-curate-advanced" });
            details.createEl("summary", {
                text: page.name,
                cls: "vault-curate-advanced-summary",
            });
            renderLegacy(details, page.items ?? [], cleanups);
            continue;
        }

        const def = item as {
            name: string;
            desc?: string | DocumentFragment;
            control?: unknown;
            action?: (el: HTMLElement, index: number) => void;
            render?: (setting: Setting, group: SettingGroup) => void | Cleanup;
        };

        if (def.control) {
            throw new Error(
                `legacy renderer: control definitions are not supported (${def.name}); use render`,
            );
        }

        if (def.action) {
            const action = def.action;
            new Setting(container)
                .setName(def.name)
                .setDesc(def.desc ?? "")
                .addButton(b => {
                    b.setButtonText(def.name);
                    b.onClick(() => action(b.buttonEl, 0));
                });
            continue;
        }

        if (def.render) {
            const s = new Setting(container).setName(def.name);
            if (def.desc) s.setDesc(def.desc);
            const c = def.render(s, undefined as never);
            if (typeof c === "function") cleanups.push(c);
            continue;
        }

        new Setting(container).setName(def.name).setDesc(def.desc ?? "");
    }
}
