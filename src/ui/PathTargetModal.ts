// Semantic Path target picker (009 D3) — standard FuzzySuggestModal over
// all indexed markdown files. The start note stays in the list; picking
// it is handled by the caller with the A=E notice (design D4).

import { App, FuzzySuggestModal, TFile } from "obsidian";

export class PathTargetModal extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        private files: TFile[],
        placeholder: string,
        private onChoose: (file: TFile) => void,
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    getItems(): TFile[] {
        return this.files;
    }

    getItemText(file: TFile): string {
        // Full path, not basename: folder context disambiguates duplicate
        // titles (H1-collision lesson, 1.0.4) and is itself fuzzy-searchable.
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onChoose(file);
    }
}
