import { MarkdownView, type App, type PaneType, type TFile } from "obsidian";
import type { SearchSnippet } from "../types";
import { locateAnchor } from "./locateAnchor";

/**
 * Open a search result at the passage its snippet came from (034 D4), or at
 * the top when there is no anchor (descriptions, Discover rows) or the
 * passage has since been edited away.
 */
export async function openAtSnippet(
    app: App,
    file: TFile,
    snippet: SearchSnippet | undefined,
    paneType: PaneType | boolean,
): Promise<void> {
    const leaf = app.workspace.getLeaf(paneType);
    let line: number | null = null;
    if (snippet?.anchor) {
        try {
            line = locateAnchor(await app.vault.cachedRead(file), snippet.anchor, snippet.chunkIndex, snippet.chunkCount, snippet.anchorRatio);
        } catch (err) {
            // Unreadable right now: still open the note, just at the top.
            console.warn("vault-curate: could not read note to locate snippet", err);
        }
    }
    if (line === null) {
        await leaf.openFile(file);
        return;
    }
    // eState.line scrolls reading and source views; in the editor, also put
    // the cursor there so the user lands on the line, not just near it.
    await leaf.openFile(file, { eState: { line } });
    if (leaf.view instanceof MarkdownView) {
        const pos = { line, ch: 0 };
        leaf.view.editor.setCursor(pos);
        leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
    }
}
