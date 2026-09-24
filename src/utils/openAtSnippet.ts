import type { App, PaneType, TFile } from "obsidian";
import type { SearchSnippet } from "../types";
import { anchorMatch } from "./locateAnchor";

/**
 * Open a search result at the passage its snippet came from (034 D4), or at
 * the top when there is no anchor (descriptions, Discover rows) or the
 * passage has since been edited away.
 *
 * Uses the same ephemeral state as Obsidian's built-in search (`match`), and
 * nothing after it: an earlier version passed `line` and then moved the
 * cursor itself, which in practice left some notes at the top in both
 * reading and editing views (T8 dogfood).
 */
export async function openAtSnippet(
    app: App,
    file: TFile,
    snippet: SearchSnippet | undefined,
    paneType: PaneType | boolean,
): Promise<void> {
    let match: ReturnType<typeof anchorMatch> = null;
    if (snippet?.anchor) {
        try {
            const content = await app.vault.cachedRead(file);
            match = anchorMatch(content, snippet.anchor, snippet.chunkIndex, snippet.chunkCount, snippet.anchorRatio);
        } catch (err) {
            // Unreadable right now: still open the note, just at the top.
            console.warn("vault-curate: could not read note to locate snippet", err);
        }
    }
    await app.workspace.getLeaf(paneType).openFile(file, match ? { eState: { match } } : undefined);
}
