/**
 * Minimal stand-in for Obsidian's DOM helpers so pure UI modules that use
 * `el.createEl(...)` can run under happy-dom. Covers only the option fields
 * this repo's tests exercise (text / value / attr / cls); it is not the
 * real implementation.
 */
type ElInfo = {
    text?: string;
    value?: string;
    cls?: string | string[];
    attr?: Record<string, string | number | boolean | null>;
};

const proto = Node.prototype as unknown as {
    createEl?: (tag: string, o?: ElInfo | string, cb?: (el: HTMLElement) => void) => HTMLElement;
};

if (typeof proto.createEl !== "function") {
    proto.createEl = function (this: Node, tag: string, o?: ElInfo | string, cb?: (el: HTMLElement) => void) {
        const doc = this.ownerDocument ?? document;
        const el = doc.createElement(tag);
        const info: ElInfo = typeof o === "string" ? { cls: o } : (o ?? {});
        if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
        if (info.text !== undefined) el.textContent = info.text;
        if (info.value !== undefined) (el as HTMLElement & { value: string }).value = info.value;
        if (info.attr) {
            for (const [k, v] of Object.entries(info.attr)) {
                if (v !== null && v !== undefined) el.setAttribute(k, String(v));
            }
        }
        this.appendChild(el);
        cb?.(el);
        return el;
    };
}
