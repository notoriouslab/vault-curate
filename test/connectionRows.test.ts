import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform, Setting } from "obsidian";
import { apiKeyRow, ollamaUrlRow } from "../src/settings/rowsQuickSetup";
import type { SettingDefinitionRender, SettingsContext } from "../src/settings/types";
import { DEFAULT_SETTINGS } from "../src/types";

function makeCtx() {
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, embeddingProvider: "ollama" },
        saveSettings: vi.fn(async () => { /* noop */ }),
        refreshMobileProvider: vi.fn(),
    };
    const ctx = {
        plugin,
        onServerChange: () => () => { /* none */ },
        serverChanged: vi.fn(),
        onWarningsChange: () => () => { /* none */ },
        warningsChanged: vi.fn(),
    } as unknown as SettingsContext;
    return { ctx, plugin };
}

/** Render the row; `type` behaves like a keystroke in Obsidian (onChange
 *  plus the DOM input event), `leave` like leaving the field. */
function field(def: SettingDefinitionRender) {
    let text!: { emit(v: string): unknown; inputEl: HTMLElement };
    const setting = new Setting(window.document.createElement("div"));
    const orig = setting.addText.bind(setting);
    setting.addText = ((cb: (c: never) => unknown) => orig((c: never) => { text = c as never; return cb(c); })) as never;
    (def.render as (s: Setting) => unknown)(setting);
    return {
        type: async (v: string) => { await text.emit(v); text.inputEl.dispatchEvent(new Event("input")); },
        leave: () => text.inputEl.dispatchEvent(new Event("change")),
    };
}

describe("mobile URL/key rows refresh the provider on change only (042 D4)", () => {
    afterEach(() => { (Platform as { isMobile: boolean }).isMobile = false; });

    for (const [name, row] of [["URL", ollamaUrlRow], ["key", apiKeyRow]] as const) {
        it(`${name}: typing → 0, leaving → 1 on mobile; 0 on desktop`, async () => {
            (Platform as { isMobile: boolean }).isMobile = true;
            const m = makeCtx();
            const f = field(row(m.ctx));
            await f.type("http://192.168.1.5:11434");
            expect(m.plugin.refreshMobileProvider).not.toHaveBeenCalled();
            f.leave();
            expect(m.plugin.refreshMobileProvider).toHaveBeenCalledTimes(1);

            (Platform as { isMobile: boolean }).isMobile = false;
            const d = makeCtx();
            const g = field(row(d.ctx));
            await g.type("x");
            g.leave();
            expect(d.plugin.refreshMobileProvider).not.toHaveBeenCalled();
        });
    }
});
