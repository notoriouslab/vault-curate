import { Keymap, Platform, SuggestModal, TFile } from "obsidian";
import type VaultSearchPlugin from "./main";
import { SearchResult } from "./types";
import { renderResultItem } from "./utils";
import { t } from "./i18n";
import { searchHybrid } from "./search/searchHybrid";

export class SearchModal extends SuggestModal<SearchResult> {
    private plugin: VaultSearchPlugin;
    private lastResults: SearchResult[] = [];
    private lastQuery = "";
    private debounceTimer: number | null = null;

    constructor(app: typeof SuggestModal.prototype.app, plugin: VaultSearchPlugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder(t.searchPlaceholder);
        this.setInstructions([
            { command: "↑↓", purpose: t.instructNav },
            { command: "↵", purpose: t.instructOpen },
            { command: "ctrl/⌘ ↵", purpose: t.instructOpenTab },
            { command: "esc", purpose: t.instructDismiss },
        ]);
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
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
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
