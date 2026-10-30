import type { OllamaModel } from "../utils";

export type PrimaryKind = "embedding" | "other";

export interface ModelSelectLabels {
    placeholder: string;
    embeddingGroup: string;
    otherGroup: string;
    notInstalled: string;
    /** When set, models whose server does not list JSON output go last,
     *  in a group of their own with this label (issue #19). */
    noJsonGroup?: string;
}

/** `name (1.2GB)` / `name (640MB)` — the size format the dropdown has always used. */
function optionLabel(m: OllamaModel): string {
    if (m.sizeGB <= 0) return m.name;
    const size = m.sizeGB < 1
        ? `${(m.sizeGB * 1000).toFixed(0)}MB`
        : `${m.sizeGB.toFixed(1)}GB`;
    return `${m.name} (${size})`;
}

// Obsidian's `createEl`, not the raw DOM constructor: it builds the node in
// the parent's own document, so pop-out windows get the right one, and it is
// what the plugin review lint expects (obsidianmd/prefer-create-el).
function addOption(parent: HTMLElement, value: string, text: string): void {
    parent.createEl("option", { value, text });
}

/**
 * Fill a model `<select>` with every model the server reports, grouped by
 * kind instead of filtered by it: the kind this dropdown is for comes first,
 * the rest stay reachable in a second group (a server may classify a model
 * differently than the user expects, and hiding it leaves no way out).
 *
 * With `labels.noJsonGroup`, models marked `jsonOutput: false` leave their
 * kind group for a last group of their own: still selectable, because
 * OpenRouter drops a parameter a provider does not support and many such
 * models answer in JSON anyway (issue #19).
 *
 * An empty group is not rendered. A `currentValue` the server does not list
 * is kept as the first entry of the first group, marked `notInstalled`, and
 * reported back so the caller can explain how to install it.
 */
export function fillModelSelect(
    select: HTMLSelectElement,
    models: OllamaModel[],
    primary: PrimaryKind,
    currentValue: string,
    labels: ModelSelectLabels,
): { missing: boolean } {
    while (select.firstChild) select.removeChild(select.firstChild);
    addOption(select, "", labels.placeholder);

    const missing = currentValue !== "" && !models.some((m) => m.name === currentValue);
    const secondary: PrimaryKind = primary === "embedding" ? "other" : "embedding";
    const demote = (m: OllamaModel) => labels.noJsonGroup !== undefined && m.jsonOutput === false;
    const plan: Array<{ label: string; items: OllamaModel[] }> = [primary, secondary].map((kind) => ({
        label: kind === "embedding" ? labels.embeddingGroup : labels.otherGroup,
        items: models.filter((m) => m.kind === kind && !demote(m)),
    }));
    if (labels.noJsonGroup !== undefined) {
        plan.push({ label: labels.noJsonGroup, items: models.filter(demote) });
    }

    let isFirstGroup = true;
    for (const group of plan) {
        const injectMissing = isFirstGroup && missing;
        isFirstGroup = false;
        if (group.items.length === 0 && !injectMissing) continue;
        const optgroup = select.createEl("optgroup", { attr: { label: group.label } });
        if (injectMissing) {
            addOption(optgroup, currentValue, `${currentValue} (${labels.notInstalled})`);
        }
        for (const m of group.items) addOption(optgroup, m.name, optionLabel(m));
    }

    select.value = currentValue;
    return { missing };
}
