import type { OllamaModel } from "../utils";

export type PrimaryKind = "embedding" | "other";

export interface ModelSelectLabels {
    placeholder: string;
    embeddingGroup: string;
    otherGroup: string;
    notInstalled: string;
}

/** `name (1.2GB)` / `name (640MB)` — the size format the dropdown has always used. */
function optionLabel(m: OllamaModel): string {
    if (m.sizeGB <= 0) return m.name;
    const size = m.sizeGB < 1
        ? `${(m.sizeGB * 1000).toFixed(0)}MB`
        : `${m.sizeGB.toFixed(1)}GB`;
    return `${m.name} (${size})`;
}

// `ownerDocument`, not the global `document`: Obsidian can host Settings and
// modals in a pop-out window, where the global points at the main window.
function addOption(parent: HTMLElement, value: string, text: string): void {
    const opt = parent.ownerDocument.createElement("option");
    opt.value = value;
    opt.textContent = text;
    parent.appendChild(opt);
}

/**
 * Fill a model `<select>` with every model the server reports, grouped by
 * kind instead of filtered by it: the kind this dropdown is for comes first,
 * the rest stay reachable in a second group (a server may classify a model
 * differently than the user expects, and hiding it leaves no way out).
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
    const plan: Array<{ kind: PrimaryKind; items: OllamaModel[] }> = [
        { kind: primary, items: models.filter((m) => m.kind === primary) },
        { kind: secondary, items: models.filter((m) => m.kind === secondary) },
    ];

    let isFirstGroup = true;
    for (const group of plan) {
        const injectMissing = isFirstGroup && missing;
        isFirstGroup = false;
        if (group.items.length === 0 && !injectMissing) continue;
        const optgroup = select.ownerDocument.createElement("optgroup");
        optgroup.label = group.kind === "embedding" ? labels.embeddingGroup : labels.otherGroup;
        if (injectMissing) {
            addOption(optgroup, currentValue, `${currentValue} (${labels.notInstalled})`);
        }
        for (const m of group.items) addOption(optgroup, m.name, optionLabel(m));
        select.appendChild(optgroup);
    }

    select.value = currentValue;
    return { missing };
}
