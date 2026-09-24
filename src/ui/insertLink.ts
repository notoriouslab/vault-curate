import type { App, MarkdownView, TFile } from "obsidian";

/**
 * 034 D6: insert a link to `target` at the cursor of `view`, formatted the
 * way the user's link settings ask for (wikilink or markdown, relative
 * path) via the file manager. Returns false, touching nothing, when there
 * is no editor to insert into — including a note open in reading mode,
 * whose editor still exists but would take the link out of sight.
 */
export function insertLinkAtCursor(app: App, target: TFile, view: MarkdownView | null): boolean {
    if (!view || view.getMode() !== "source") return false;
    view.editor.replaceSelection(app.fileManager.generateMarkdownLink(target, view.file?.path ?? ""));
    return true;
}
