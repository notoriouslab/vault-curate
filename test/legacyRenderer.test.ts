import { describe, expect, it, vi } from "vitest";
import type { SettingDefinitionItem, Setting } from "obsidian";
import { renderLegacy, type Cleanup } from "../src/settings/legacyRenderer";

vi.mock("obsidian", () => import("./setup/obsidianSettingStub"));

function host(): HTMLElement {
    return document.createElement("div");
}

describe("renderLegacy", () => {
    it("renders a group heading followed by its items", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const items: SettingDefinitionItem[] = [
            {
                type: "group",
                heading: "Quick setup",
                items: [
                    { name: "Alpha", desc: "a" },
                    { name: "Beta", desc: "b" },
                ],
            },
        ];
        renderLegacy(el, items, cleanups);

        const headings = el.querySelectorAll(".setting-item-heading");
        expect(headings.length).toBe(1);
        expect(headings[0].querySelector(".setting-item-name")?.textContent).toBe("Quick setup");
        // heading row + 2 item rows
        expect(el.querySelectorAll(".setting-item").length).toBe(3);
    });

    it("renders a page as a details/summary block holding its items", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const items: SettingDefinitionItem[] = [
            {
                type: "page",
                name: "Advanced",
                items: [{ name: "Chunk size", desc: "cs" }],
            },
        ];
        renderLegacy(el, items, cleanups);

        const details = el.querySelector("details.vault-curate-advanced");
        expect(details).not.toBeNull();
        const summary = details!.querySelector("summary.vault-curate-advanced-summary");
        expect(summary?.textContent).toBe("Advanced");
        expect(details!.querySelectorAll(".setting-item").length).toBe(1);
        expect(el.querySelectorAll(".setting-item").length).toBe(1);
    });

    it("renders an action definition as a button that invokes the action once", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const action = vi.fn();
        renderLegacy(el, [{ name: "Rebuild index", desc: "rd", action }], cleanups);

        const item = el.querySelector(".setting-item");
        expect(item).not.toBeNull();
        const button = item!.querySelector("button");
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe("Rebuild index");
        button!.dispatchEvent(new window.MouseEvent("click"));
        expect(action).toHaveBeenCalledTimes(1);
    });

    it("calls render with the Setting and collects its cleanup", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const cleanup = vi.fn();
        const render = vi.fn((setting: Setting) => {
            setting.addButton(b => b.setButtonText("x"));
            return cleanup;
        });
        renderLegacy(el, [{ name: "Hot days", desc: "hd", render }], cleanups);

        expect(render).toHaveBeenCalledTimes(1);
        const passed = render.mock.calls[0][0];
        expect(passed).toBeDefined();
        expect((passed as unknown as { settingEl: HTMLElement }).settingEl.className)
            .toContain("setting-item");
        expect(el.querySelector(".setting-item-name")?.textContent).toBe("Hot days");
        expect(el.querySelector(".setting-item-description")?.textContent).toBe("hd");
        expect(cleanups.length).toBe(1);
        expect(cleanups[0]).toBe(cleanup);
    });

    it("does not collect a cleanup when render returns nothing", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        renderLegacy(el, [{ name: "Auto index", render: () => { /* no cleanup */ } }], cleanups);

        expect(cleanups.length).toBe(0);
        expect(el.querySelectorAll(".setting-item").length).toBe(1);
    });

    it("skips an item whose visible predicate is false", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const render = vi.fn();
        renderLegacy(
            el,
            [{ name: "API key", render, visible: () => false }],
            cleanups,
        );

        expect(render).not.toHaveBeenCalled();
        expect(el.querySelectorAll(".setting-item").length).toBe(0);
    });

    it("throws on a control definition, naming the offending setting", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const items = [
            {
                name: "Top results",
                control: { type: "text", key: "topResults" },
            },
        ] as unknown as SettingDefinitionItem[];

        expect(() => renderLegacy(el, items, cleanups)).toThrow(/Top results/);
    });

    it("renders a plain definition as a name/description row", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        renderLegacy(el, [{ name: "Built-in model", desc: "Downloaded on first use." }], cleanups);

        const item = el.querySelector(".setting-item");
        expect(item!.querySelector(".setting-item-name")?.textContent).toBe("Built-in model");
        expect(item!.querySelector(".setting-item-description")?.textContent)
            .toBe("Downloaded on first use.");
        expect(item!.querySelector("button")).toBeNull();
    });

    it("recurses through page > group > render", () => {
        const el = host();
        const cleanups: Cleanup[] = [];
        const render = vi.fn(() => () => { /* cleanup */ });
        renderLegacy(
            el,
            [
                {
                    type: "page",
                    name: "Advanced",
                    items: [
                        {
                            type: "group",
                            heading: "Actions",
                            items: [{ name: "Rebuild", render }],
                        },
                    ],
                },
            ] as SettingDefinitionItem[],
            cleanups,
        );

        const details = el.querySelector("details.vault-curate-advanced");
        expect(details).not.toBeNull();
        const heading = details!.querySelector(".setting-item-heading");
        expect(heading?.querySelector(".setting-item-name")?.textContent).toBe("Actions");
        expect(details!.querySelectorAll(".setting-item").length).toBe(2);
        expect(render).toHaveBeenCalledTimes(1);
        expect(cleanups.length).toBe(1);
    });
});
