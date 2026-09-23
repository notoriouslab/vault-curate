/**
 * Minimal stand-in for the slice of the `obsidian` module the settings
 * renderer touches, so unit tests can run under happy-dom. Feed it to
 * `vi.mock("obsidian", () => import("./setup/obsidianSettingStub"))`.
 *
 * This is a test double only: it is NOT Obsidian's implementation and it
 * covers only the fields and methods this repo's tests exercise.
 */

export class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        const doc = containerEl.ownerDocument ?? document;
        this.settingEl = doc.createElement("div");
        this.settingEl.className = "setting-item";
        this.infoEl = doc.createElement("div");
        this.infoEl.className = "setting-item-info";
        this.nameEl = doc.createElement("div");
        this.nameEl.className = "setting-item-name";
        this.descEl = doc.createElement("div");
        this.descEl.className = "setting-item-description";
        this.infoEl.appendChild(this.nameEl);
        this.infoEl.appendChild(this.descEl);
        this.controlEl = doc.createElement("div");
        this.controlEl.className = "setting-item-control";
        this.settingEl.appendChild(this.infoEl);
        this.settingEl.appendChild(this.controlEl);
        containerEl.appendChild(this.settingEl);
    }

    setName(name: string): this {
        this.nameEl.textContent = name;
        return this;
    }

    setDesc(desc: string | DocumentFragment): this {
        this.descEl.textContent = "";
        if (typeof desc === "string") this.descEl.textContent = desc;
        else this.descEl.appendChild(desc);
        return this;
    }

    setHeading(): this {
        this.settingEl.classList.add("setting-item-heading");
        return this;
    }

    setClass(cls: string): this {
        this.settingEl.classList.add(cls);
        return this;
    }

    addButton(cb: (b: ButtonStub) => unknown): this {
        cb(new ButtonStub(this.controlEl));
        return this;
    }

    addText(cb: (c: TextStub) => unknown): this {
        cb(new TextStub(this.controlEl, "input"));
        return this;
    }

    addTextArea(cb: (c: TextStub) => unknown): this {
        cb(new TextStub(this.controlEl, "textarea"));
        return this;
    }

    addToggle(cb: (c: ToggleStub) => unknown): this {
        cb(new ToggleStub(this.controlEl));
        return this;
    }

    addDropdown(cb: (c: DropdownStub) => unknown): this {
        cb(new DropdownStub(this.controlEl));
        return this;
    }
}

export class ButtonStub {
    buttonEl: HTMLButtonElement;

    constructor(controlEl: HTMLElement) {
        const doc = controlEl.ownerDocument ?? document;
        this.buttonEl = doc.createElement("button");
        controlEl.appendChild(this.buttonEl);
    }

    setButtonText(text: string): this {
        this.buttonEl.textContent = text;
        return this;
    }

    setCta(): this {
        this.buttonEl.classList.add("mod-cta");
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.buttonEl.disabled = disabled;
        return this;
    }

    onClick(cb: (evt: MouseEvent) => unknown): this {
        this.buttonEl.addEventListener("click", cb as EventListener);
        return this;
    }
}

class ValueStub<E extends HTMLElement> {
    protected value = "";
    protected handler: ((val: string) => unknown) | null = null;

    constructor(readonly el: E) {}

    getValue(): string {
        return this.value;
    }

    setValue(val: string): this {
        this.value = val;
        (this.el as HTMLElement & { value?: string }).value = val;
        return this;
    }

    setPlaceholder(text: string): this {
        this.el.setAttribute("placeholder", text);
        return this;
    }

    setDisabled(disabled: boolean): this {
        (this.el as HTMLElement & { disabled?: boolean }).disabled = disabled;
        return this;
    }

    onChange(cb: (val: string) => unknown): this {
        this.handler = cb;
        return this;
    }

    /** Test helper: simulate the user changing the control's value. */
    emit(val: string): unknown {
        this.value = val;
        (this.el as HTMLElement & { value?: string }).value = val;
        return this.handler?.(val);
    }
}

export class TextStub extends ValueStub<HTMLElement> {
    inputEl: HTMLElement;

    constructor(controlEl: HTMLElement, tag: "input" | "textarea") {
        const doc = controlEl.ownerDocument ?? document;
        const el = doc.createElement(tag);
        controlEl.appendChild(el);
        super(el);
        this.inputEl = el;
    }
}

export class ToggleStub {
    toggleEl: HTMLElement;
    private value = false;
    private handler: ((val: boolean) => unknown) | null = null;

    constructor(controlEl: HTMLElement) {
        const doc = controlEl.ownerDocument ?? document;
        this.toggleEl = doc.createElement("div");
        this.toggleEl.className = "checkbox-container";
        controlEl.appendChild(this.toggleEl);
    }

    getValue(): boolean {
        return this.value;
    }

    setValue(val: boolean): this {
        this.value = val;
        return this;
    }

    setDisabled(disabled: boolean): this {
        (this.toggleEl as HTMLElement & { disabled?: boolean }).disabled = disabled;
        return this;
    }

    onChange(cb: (val: boolean) => unknown): this {
        this.handler = cb;
        return this;
    }

    /** Test helper: simulate the user flipping the toggle. */
    emit(val: boolean): unknown {
        this.value = val;
        return this.handler?.(val);
    }
}

export class DropdownStub extends ValueStub<HTMLSelectElement> {
    selectEl: HTMLSelectElement;

    constructor(controlEl: HTMLElement) {
        const doc = controlEl.ownerDocument ?? document;
        const el = doc.createElement("select");
        controlEl.appendChild(el);
        super(el);
        this.selectEl = el;
    }

    addOption(value: string, display: string): this {
        const doc = this.selectEl.ownerDocument ?? document;
        const opt = doc.createElement("option");
        opt.value = value;
        opt.textContent = display;
        this.selectEl.appendChild(opt);
        return this;
    }
}

export class Modal {}
export class Notice {}
export class PluginSettingTab {}

export const Platform = { isMobile: false };

export const requireApiVersion = () => false;

export const requestUrl = () => {
    throw new Error("requestUrl not available in tests");
};

export const createFragment = (cb: (frag: DocumentFragment) => void): DocumentFragment => {
    const f = document.createDocumentFragment();
    cb(f);
    return f;
};
