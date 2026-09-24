import { Keymap, MarkdownView, Notice, Platform, SuggestModal, TFile } from "obsidian";
import type VaultSearchPlugin from "./main";
import { SearchResult } from "./types";
import { renderResultItem } from "./utils";
import { openAtSnippet } from "./utils/openAtSnippet";
import { insertLinkAtCursor } from "./ui/insertLink";
import { t } from "./i18n";
import { searchHybrid } from "./search/searchHybrid";

export class SearchModal extends SuggestModal<SearchResult> {
    private plugin: VaultSearchPlugin;
    private lastResults: SearchResult[] = [];
    private lastQuery = "";
    private debounceTimer: number | null = null;
    /** 034 D6: the editor that was active when the modal opened (focus moves
     *  to the modal, so it has to be captured up front). */
    private readonly sourceView: MarkdownView | null;

    constructor(app: typeof SuggestModal.prototype.app, plugin: VaultSearchPlugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder(t.searchPlaceholder);
        this.sourceView = app.workspace.getActiveViewOfType(MarkdownView);
        this.setInstructions([
            { command: "↑↓", purpose: t.instructNav },
            { command: "↵", purpose: t.instructOpen },
            { command: "ctrl/⌘ ↵", purpose: t.instructOpenTab },
            { command: "alt ↵", purpose: t.instructInsertLink },
            { command: "esc", purpose: t.instructDismiss },
        ]);
        // 034 D6: Alt+Enter inserts a link instead of opening (Omnisearch's
        // binding); onChooseSuggestion sees evt.altKey and branches.
        this.scope.register(["Alt"], "Enter", (evt) => {
            this.selectActiveSuggestion(evt);
            return false;
        });
    }

    getSuggestions(query: string): SearchResult[] {
        if (!query || query.length < 2) {
            this.lastResults = [];
            return [];
        }
        if (query !== this.lastQuery) {
            this.lastQuery = query;
            this.scheduleSearch(query);
        }
        return this.lastResults;
    }

    renderSuggestion(result: SearchResult, el: HTMLElement) {
        const container = el.createDiv({ cls: "vault-curate-result" });
        renderResultItem(container, result, this.app);
    }

    onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
        const file = this.app.vault.getAbstractFileByPath(result.path);
        // Alt+Enter, or Alt+click (same intent), inserts a link.
        if (evt.altKey && file instanceof TFile) {
            if (!insertLinkAtCursor(this.app, file, this.sourceView)) new Notice(t.noticeInsertLinkNoEditor);
            return;
        }
        if (file instanceof TFile) {
            // 034 D4: open at the matched passage.
            void openAtSnippet(this.app, file, result.snippet, Keymap.isModEvent(evt));
        }
    }

    private scheduleSearch(query: string) {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => { void this.executeSearch(query); }, 300);
    }

    private async executeSearch(query: string) {
        // 015 review W1: on mobile, wait for the index gate instead of
        // silently returning [] — a query typed during loading runs as
        // soon as the store lands.
        if (Platform.isMobile && !this.plugin.store) {
            try {
                await this.plugin.ensureStoreLoaded();
            } catch {
                return; // gate state renders in the sidebar
            }
        }
        // 015: mobile searches without a provider (BM25 + fuzzy).
        if (!this.plugin.store || (!this.plugin.provider && !Platform.isMobile)) return;
        try {
            if (query !== this.lastQuery) return;
            const results = await searchHybrid(
                query,
                { store: this.plugin.store, provider: this.plugin.provider },
                {
                    topResults: this.plugin.settings.topResults,
                    searchScope: this.plugin.settings.searchScope,
                    tierResolver: this.plugin.tierResolver(),
                    exists: this.plugin.existsPredicate(),
                    synonyms: this.plugin.settings.synonyms,
                },
            );
            if (query !== this.lastQuery) return;
            this.lastResults = results;
            this.inputEl.dispatchEvent(new Event("input"));
        } catch (e) {
            console.error("vault-curate: hybrid search failed", e);
        }
    }

    onClose() {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    }
}
