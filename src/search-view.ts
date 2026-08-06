import { ItemView, Keymap, Menu, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import type { PaneType } from "obsidian";

// Obsidian's dragManager is not in public types but exists at runtime
declare module "obsidian" {
    interface App {
        dragManager: {
            handleDrag(el: HTMLElement, callback: (e: DragEvent) => unknown): void;
            dragFile(e: DragEvent, file: TFile, source?: string): unknown;
        };
    }
}
import type VaultSearchPlugin from "./main";
import { SearchResult } from "./types";
import { formatLocalDateTime, getContentPreview, renderResultItem, toWikilink } from "./utils";
import { searchHybrid } from "./search/searchHybrid";
import { discoverForNoteSqlite, globalDiscoverGroupedSqlite } from "./search/discoverSqlite";
import type { GroupedResults } from "./search/globalProfile";
import { classifyMocSize } from "./clustering";
import { FallbackToFlatError, generateMocGrouped, NoteForMoc, renderMocGrouped } from "./moc-generator";
import { t } from "./i18n";
import { pairKey } from "./utils/pairKey";

/** 013 D11: how a result row resolves its dismiss write. Pair-level rows
 *  (Find Similar / Discover-current) carry the anchor note the results were
 *  computed FOR — never `getActiveFile()` at click time, which records the
 *  wrong pair once the user switches files. Note-level rows (global
 *  discover) have no anchor. Rows without a context (Search tab) get no ✕. */
type DismissContext = { kind: "pair"; anchor: string } | { kind: "note" };

export const VIEW_TYPE_SEARCH = "vault-curate-view";

type TabId = "search" | "discover";
type DiscoverMode = "current" | "global";

export class SearchView extends ItemView {
    plugin: VaultSearchPlugin;

    // Tab state
    private activeTab: TabId = "search";
    private searchContainer!: HTMLDivElement;
    private discoverContainer!: HTMLDivElement;
    private tabEls = {} as Record<TabId, HTMLDivElement>;

    // Search state
    private inputEl!: HTMLInputElement;
    private searchResultsEl!: HTMLDivElement;
    private searchStatusEl!: HTMLDivElement;
    private debounceTimer: number | null = null;
    private currentQuery = "";
    private lastResults: SearchResult[] = [];

    // Discover state
    private discoverMode: DiscoverMode = "current";
    private discoverStatusEl!: HTMLDivElement;
    private discoverResultsEl!: HTMLDivElement;
    private modeEls = {} as Record<DiscoverMode, HTMLButtonElement>;
    private mocBtn!: HTMLButtonElement;
    /** Per-run abort token for the global sweep (red-team F4): a shared
     *  mutable flag lets a new run "revive" a cancelled old one — same
     *  fix shape as perFileAbort below. */
    private globalAbort: { value: boolean } | null = null;
    private lastDiscoverResults: SearchResult[] = [];
    /** 013 D11: grouped global-discover results kept as data so a dismiss
     *  can re-render with correct header counts. */
    private lastGroups: GroupedResults[] = [];
    // Pin state — session-only (plugin reload resets). Locks Discover sidebar
    // to a specific note so file-open events don't refresh away the context.
    private pinnedFile: TFile | null = null;
    private pinBtn!: HTMLButtonElement;
    private pinStatusEl!: HTMLDivElement;
    /** Path the latest discover-for-file invocation is computing for.
     *  Used to discard stale renders when the user switches files faster
     *  than the cosine sweep completes. */
    private discoverForPath: string | null = null;
    /** Abort flag for the in-flight per-file sweep. Flipped to true when a
     *  new sweep starts so the old one bails out cooperatively (the helper
     *  checks `cancelled.value` each yield) — closes the A→B→A race where
     *  B's late result would overwrite A's view. */
    private perFileAbort: { value: boolean } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: VaultSearchPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_SEARCH; }
    getDisplayText() { return t.viewDisplayName; }
    getIcon() { return "compass"; }

    async onOpen() {
        await super.onOpen();
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("vault-curate-panel");

        // Tab bar
        const tabBar = container.createDiv({ cls: "vault-curate-tab-bar" });
        this.tabEls.search = this.buildTab(tabBar, "search", t.tabSearch);
        this.tabEls.discover = this.buildTab(tabBar, "discover", t.tabDiscover);

        // Search content
        this.searchContainer = container.createDiv({ cls: "vault-curate-tab-content" });
        this.buildSearchUI(this.searchContainer);

        // Discover content
        this.discoverContainer = container.createDiv({ cls: "vault-curate-tab-content" });
        this.buildDiscoverUI(this.discoverContainer);

        this.switchTab("search");
    }

    // ── Tab management ─────────────────────────────────

    private buildTab(parent: HTMLElement, id: TabId, label: string): HTMLDivElement {
        const tab = parent.createDiv({ cls: "vault-curate-tab", text: label });
        tab.addEventListener("click", () => this.switchTab(id));
        return tab;
    }

    private switchTab(id: TabId) {
        this.activeTab = id;

        this.tabEls.search.toggleClass("is-active", id === "search");
        this.tabEls.discover.toggleClass("is-active", id === "discover");

        this.searchContainer.toggleClass("vault-curate-hidden", id !== "search");
        this.discoverContainer.toggleClass("vault-curate-hidden", id !== "discover");

        if (id === "search") {
            this.inputEl?.focus();
        } else if (id === "discover" && this.discoverMode === "current") {
            // Trigger discovery for current file when switching to Discover tab
            const file = this.app.workspace.getActiveFile();
            if (file) void this.discoverForFile(file);
        }
    }

    // ── Search UI ──────────────────────────────────────

    private buildSearchUI(container: HTMLDivElement) {
        const searchBar = container.createDiv({ cls: "vault-curate-bar" });
        this.inputEl = searchBar.createEl("input", {
            type: "text",
            placeholder: t.searchPlaceholder,
            cls: "vault-curate-input",
        });
        this.inputEl.addEventListener("input", () => {
            this.scheduleSearch(this.inputEl.value);
        });

        const searchActions = container.createDiv({ cls: "vault-curate-mode-toggle" });
        searchActions.createEl("button", {
            text: t.generateMoc,
            cls: "vault-curate-mode-btn vault-curate-moc-btn",
        }).addEventListener("click", () => void this.generateMocFromSearch());

        this.searchStatusEl = container.createDiv({ cls: "vault-curate-status" });
        this.searchResultsEl = container.createDiv({ cls: "vault-curate-results" });
    }

    focusInput() {
        if (this.activeTab === "search") {
            this.inputEl?.focus();
        }
    }

    showResults(results: SearchResult[], label: string, anchorPath: string) {
        this.lastResults = results;
        this.lastDiscoverResults = results;
        this.inputEl.value = "";
        this.switchTab("discover");
        this.setDiscoverMode("current");
        this.discoverStatusEl.setText(label);
        this.renderDiscoverResults(results, anchorPath);
    }

    async onClose() {
        await super.onClose();
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        if (this.globalAbort) this.globalAbort.value = true;
    }

    private scheduleSearch(query: string) {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        if (!query || query.length < 2) {
            this.searchResultsEl.empty();
            this.searchStatusEl.setText("");
            return;
        }
        this.searchStatusEl.setText(t.searching);
        this.debounceTimer = window.setTimeout(() => { void this.executeSearch(query); }, 300);
    }

    private async executeSearch(query: string) {
        this.currentQuery = query;

        // 015: mobile searches without a provider (BM25 + fuzzy); desktop
        // keeps requiring one so a broken provider stays loud, not silent.
        if (!this.plugin.store || (!this.plugin.provider && !Platform.isMobile)) {
            this.searchStatusEl.setText(t.indexEmpty);
            return;
        }

        try {
            if (query !== this.currentQuery) return;
            // 015: a mid-query semantic failure degrades to keyword-only —
            // say so in the status line instead of failing the whole search.
            let degraded = false;
            const results = await searchHybrid(
                query,
                { store: this.plugin.store, provider: this.plugin.provider },
                {
                    topResults: this.plugin.settings.topResults,
                    searchScope: this.plugin.settings.searchScope,
                    tierResolver: this.plugin.tierResolver(),
                    onDegrade: () => { degraded = true; },
                },
            );
            if (query !== this.currentQuery) return;
            this.lastResults = results;
            this.renderSearchResults();
            this.searchStatusEl.setText(
                degraded
                    ? `${t.searchResults(this.lastResults.length)} · ${t.semanticDegraded}`
                    : t.searchResults(this.lastResults.length),
            );
        } catch (e) {
            this.searchStatusEl.setText(t.searchFailed);
            console.error("vault-curate: hybrid search failed", e);
        }
    }

    private renderSearchResults() {
        this.searchResultsEl.empty();
        for (const result of this.lastResults) {
            this.createResultItem(this.searchResultsEl, result);
        }
    }

    // ── Discover UI ────────────────────────────────────

    private buildDiscoverUI(container: HTMLDivElement) {
        // Mode toggle
        const modeBar = container.createDiv({ cls: "vault-curate-mode-toggle" });
        this.modeEls.current = modeBar.createEl("button", {
            text: t.discoverCurrentNote,
            cls: "vault-curate-mode-btn",
        });
        this.modeEls.global = modeBar.createEl("button", {
            text: t.discoverGlobal,
            cls: "vault-curate-mode-btn",
        });
        this.mocBtn = modeBar.createEl("button", {
            text: t.generateMoc,
            cls: "vault-curate-mode-btn vault-curate-moc-btn",
        });
        // Semantic Canvas Graph (006) — graphs the pinned note if any,
        // otherwise the active note (same target semantics as pin).
        const graphBtn = modeBar.createEl("button", {
            text: t.discoverGraphBtn,
            cls: "vault-curate-mode-btn vault-curate-graph-btn",
        });
        graphBtn.addEventListener("click", () => {
            const file = this.pinnedFile ?? this.app.workspace.getActiveFile();
            if (!file || file.extension !== "md") {
                new Notice(t.discoverGraphNoFile);
                return;
            }
            void this.plugin.generateGraphCanvas(file);
        });
        // Pin toggle — rightmost in mode bar, adjacent to mocBtn.
        this.pinBtn = modeBar.createEl("button", {
            text: "\u{1F4CC}",  // 📌
            cls: "vault-curate-mode-btn vault-curate-pin-btn",
            attr: { "aria-label": t.discoverPin, title: t.discoverPin },
        });
        this.modeEls.current.addEventListener("click", () => this.setDiscoverMode("current"));
        this.modeEls.global.addEventListener("click", () => this.setDiscoverMode("global"));
        this.mocBtn.addEventListener("click", () => void this.generateMoc());
        this.pinBtn.addEventListener("click", () => this.togglePin());

        // Pin status line — hidden until a file is pinned.
        this.pinStatusEl = container.createDiv({ cls: "vault-curate-pin-status vault-curate-hidden" });

        this.discoverStatusEl = container.createDiv({ cls: "vault-curate-status" });
        this.discoverResultsEl = container.createDiv({ cls: "vault-curate-results" });

        this.setDiscoverMode("current");
    }

    // ── Pin Discover ───────────────────────────────────

    /** Public — main.ts onActiveFileChange checks this before refreshing. */
    isPinned(): boolean {
        return this.pinnedFile !== null;
    }

    /** Public — main.ts vault.on('rename') re-renders status to pick up new basename.
     *  Obsidian auto-updates TFile.path on rename, so we identify by reference. */
    handleFileRenamed(file: TFile) {
        if (this.pinnedFile === file) {
            this.renderPinStatus();
        }
    }

    /** Public — main.ts vault.on('delete') auto-unpins + shows Notice. */
    handleFileDeleted(path: string) {
        if (this.pinnedFile?.path === path) {
            this.unpin();
            new Notice(t.discoverPinFileGone);
        }
    }

    private togglePin() {
        if (this.pinnedFile !== null) {
            this.unpin();
            return;
        }
        const active = this.app.workspace.getActiveFile();
        if (!active) {
            new Notice(t.discoverPinNoFile);
            return;
        }
        this.pinnedFile = active;
        this.renderPinStatus();
        this.pinBtn.addClass("is-active");
        this.pinBtn.setAttribute("aria-label", t.discoverUnpin);
        this.pinBtn.setAttribute("title", t.discoverUnpin);
    }

    private unpin() {
        this.pinnedFile = null;
        this.pinStatusEl.toggleClass("vault-curate-hidden", true);
        this.pinBtn.removeClass("is-active");
        this.pinBtn.setAttribute("aria-label", t.discoverPin);
        this.pinBtn.setAttribute("title", t.discoverPin);
    }

    private renderPinStatus() {
        if (!this.pinnedFile) {
            this.pinStatusEl.toggleClass("vault-curate-hidden", true);
            return;
        }
        this.pinStatusEl.setText(t.discoverPinnedTo(this.pinnedFile.basename));
        this.pinStatusEl.toggleClass("vault-curate-hidden", false);
    }

    private setDiscoverMode(mode: DiscoverMode) {
        if (this.globalAbort) this.globalAbort.value = true; // Cancel any running global computation
        // User switching to global = implicit unpin (pin is a current-mode concept).
        if (mode === "global" && this.pinnedFile !== null) {
            this.unpin();
        }
        this.discoverMode = mode;
        this.modeEls.current.toggleClass("is-active", mode === "current");
        this.modeEls.global.toggleClass("is-active", mode === "global");

        if (mode === "current") {
            const file = this.app.workspace.getActiveFile();
            if (file) {
                void this.discoverForFile(file);
            } else {
                this.discoverStatusEl.setText("");
                this.discoverResultsEl.empty();
            }
        } else {
            void this.runGlobalDiscover();
        }
    }

    // ── Public methods for main.ts ─────────────────────

    isDiscoverTabActive(): boolean {
        return this.activeTab === "discover";
    }

    showGlobalDiscover() {
        this.switchTab("discover");
        this.setDiscoverMode("global");
    }

    async discoverForFile(file: TFile): Promise<void> {
        // Cancel any prior sweep that hasn't finished yet — without this,
        // an A→B→A switch where B is still running could let B's late
        // result render INTO the A view (stamp matches B at B's resume).
        if (this.perFileAbort) this.perFileAbort.value = true;
        const localAbort = { value: false };
        this.perFileAbort = localAbort;

        // Stamp BEFORE any guards so an un-indexed file visit also updates
        // the stamp. Otherwise a stale stamp from an earlier indexed file
        // can let that earlier sweep's late completion overwrite the
        // "not indexed" message we're about to set here.
        this.discoverForPath = file.path;
        const store = this.plugin.store;
        if (!store) {
            this.discoverStatusEl.setText(t.discoverNoIndex);
            this.discoverResultsEl.empty();
            return;
        }
        const note = store.getNote(file.path);
        if (!note) {
            this.discoverStatusEl.setText(t.notIndexed);
            this.discoverResultsEl.empty();
            return;
        }
        this.discoverStatusEl.setText(t.discoverComputing);
        const results = await discoverForNoteSqlite(file.path, store, {
            minScore: this.plugin.settings.minScore,
            topResults: this.plugin.settings.topResults,
            tierResolver: this.plugin.tierResolver(),
            kwRank: this.plugin.relatedKwRankFor(file),
            dismissedPairs: this.plugin.settings.dismissedPairs,
        }, localAbort);
        // Discard stale result if another file took over while we were
        // computing. Two guards: localAbort flipped by a later sweep AND
        // path stamp moved on. Either alone is enough; both for safety.
        if (localAbort.value || this.discoverForPath !== file.path) return;
        this.discoverStatusEl.setText(
            results.length > 0
                ? t.discoverRelatedTo(note.title)
                : t.discoverEmpty,
        );
        this.renderDiscoverResults(results, file.path);
    }

    private async runGlobalDiscover() {
        const store = this.plugin.store;
        if (!store) {
            this.discoverStatusEl.setText(t.discoverNoIndex);
            this.discoverResultsEl.empty();
            return;
        }

        if (this.globalAbort) this.globalAbort.value = true;
        const abort = { value: false };
        this.globalAbort = abort;
        this.discoverStatusEl.setText(t.discoverComputing);
        this.discoverResultsEl.empty();

        // 012: thinking profile (recent judgment-action notes) replaces
        // the Hot-pool anchor; results come back grouped by top folder.
        const profile = this.plugin.globalProfileFor();
        if (!profile.centroid) {
            this.discoverStatusEl.setText(t.discoverGlobalNoProfile);
            this.renderDiscoverResults([], null);
            return;
        }

        const groups = await globalDiscoverGroupedSqlite(
            store,
            {
                minScore: this.plugin.settings.minScore,
                centroid: profile.centroid,
                kwRank: profile.kwRank,
                tierResolver: this.plugin.tierResolver(),
                dismissedNotes: this.plugin.settings.dismissedNotes,
            },
            (done, total) => {
                if (!abort.value) {
                    this.discoverStatusEl.setText(t.discoverProgress(done, total));
                }
            },
            abort,
        );

        if (abort.value) return;

        if (groups.length === 0) {
            // Distinguish why: no Cold candidates vs all below minScore.
            // MUST diagnose with the same derived tier the computation used
            // (010 review).
            const all = store.getAllNotesLight();
            const tierResolver = this.plugin.tierResolver();
            const hasCold = all.some(r => tierResolver(r.path) === "cold");
            this.discoverStatusEl.setText(
                !hasCold ? t.discoverGlobalNoCold : t.discoverGlobalAllFiltered,
            );
            this.renderDiscoverResults([], null);
            return;
        }
        this.discoverStatusEl.setText(t.discoverGlobalDesc);
        this.renderGroupedResults(groups);
    }

    /** 012 D4: grouped rendering — one header per top-level folder, the
     *  usual result items beneath. MOC generation keeps working off the
     *  flattened list. */
    private renderGroupedResults(groups: GroupedResults[]) {
        this.lastGroups = groups;
        this.lastDiscoverResults = groups.flatMap(g => g.results);
        this.discoverResultsEl.empty();
        for (const g of groups) {
            this.discoverResultsEl.createDiv({
                cls: "vault-curate-group-header",
                text: `${g.group} · ${g.results.length}`,
            });
            for (const result of g.results) {
                this.createResultItem(this.discoverResultsEl, result, { kind: "note" });
            }
        }
    }

    /** 013 D11: a dismissed note-level row re-renders the grouped list from
     *  data, so the group header count stays honest and an emptied group
     *  disappears with its header (驗收 11). */
    private removeNoteFromGroups(path: string) {
        const groups = this.lastGroups
            .map((g) => ({ ...g, results: g.results.filter((r) => r.path !== path) }))
            .filter((g) => g.results.length > 0);
        this.renderGroupedResults(groups);
        // Dismissing the last row leaves an empty panel — the status line
        // must follow, or it keeps narrating results that no longer exist
        // (red-team W3).
        if (groups.length === 0) this.discoverStatusEl.setText(t.discoverEmpty);
    }

    private renderDiscoverResults(results: SearchResult[], anchorPath: string | null) {
        this.lastDiscoverResults = results;
        this.discoverResultsEl.empty();
        const dismiss: DismissContext | undefined =
            anchorPath !== null ? { kind: "pair", anchor: anchorPath } : undefined;
        for (const result of results) {
            this.createResultItem(this.discoverResultsEl, result, dismiss);
        }
    }

    // ── MOC generation ───────────────────────────────────

    /** Public: expose current-tab results for command checkCallback. */
    getCurrentResults(): SearchResult[] {
        if (this.activeTab === "discover") return this.lastDiscoverResults;
        return this.lastResults;
    }

    /**
     * Phase 7: sidebar "Generate MOC" buttons now invoke MOC 2.0 grouped flow.
     * generateMocGroupedFlow internally falls back to flat MOC (buildMoc) when
     * results < 5 or clustering is degenerate.
     */
    private async generateMocFromSearch() {
        await this.generateMocGroupedFlow();
    }

    private async generateMoc() {
        await this.generateMocGroupedFlow();
    }

    /** Flat MOC fallback (used by generateMocGroupedFlow when clustering can't help). */
    private async buildMocFlatFromCurrentTab(): Promise<void> {
        if (this.activeTab === "discover") {
            await this.buildMoc(this.lastDiscoverResults, `discover-${this.discoverMode}`);
        } else {
            await this.buildMoc(this.lastResults, "search");
        }
    }

    /**
     * MOC 2.0 entry point. Attempts topic-grouped MOC generation; falls back
     * to the flat v0.3.0 MOC when clustering is degenerate or results < 5.
     */
    async generateMocGroupedFlow(): Promise<void> {
        const results = this.getCurrentResults();
        console.debug("[MOC 2.0] tab:", this.activeTab, "results:", results.length);
        if (results.length === 0) {
            new Notice(t.mocNoResults);
            return;
        }

        const query = this.activeTab === "discover"
            ? (this.app.workspace.getActiveFile()?.basename ?? "Discover")
            : (this.currentQuery || "Search");

        const tier = classifyMocSize(results.length);
        console.debug("[MOC 2.0] tier:", tier, "query:", query);

        if (tier === "block") {
            if (results.length < 5) {
                new Notice(t.mocTooFewResults);
                await this.buildMocFlatFromCurrentTab();
            } else {
                new Notice(t.mocTooManyResults(results.length));
            }
            return;
        }

        // tier === "warn" (51-100 notes): MVP just proceeds. A confirmation
        // modal is tracked as v0.4.1 follow-up (design D6 warn tier).

        // Phase 7 (004 rebrand): assemble NoteForMoc by reading body_vec from
        // SQLite (D8). The legacy in-memory plugin.index path is gone; description
        // comes from notes.description (SSOT) with metadataCache as fallback for
        // edits made since the last index pass.
        const store = this.plugin.store;
        if (!store) {
            new Notice(t.indexEmpty);
            return;
        }
        const notesForMoc: NoteForMoc[] = [];
        const missingPaths: string[] = [];
        // Establish the canonical dim from the first valid note so we can
        // skip rows with mismatched dim (provider switched mid-index).
        // Mixed dim feeds clustering NaN distances and corrupts the MOC silently.
        let canonicalDim = 0;
        let dimMismatchCount = 0;
        for (const r of results) {
            const stored = store.getNote(r.path);
            // 007 D4/A1: clustering runs on the same composed noteVec every
            // other surface ranks with (ui-state consistency).
            const noteVec = store.getNoteVec(r.path);
            if (!stored || !noteVec || noteVec.length === 0) {
                missingPaths.push(r.path);
                continue;
            }
            if (canonicalDim === 0) canonicalDim = noteVec.length;
            else if (noteVec.length !== canonicalDim) {
                dimMismatchCount++;
                continue;
            }
            let description = stored.description ?? "";
            if (!description) {
                const file = this.app.vault.getAbstractFileByPath(r.path);
                if (file instanceof TFile) {
                    const cache = this.app.metadataCache.getFileCache(file);
                    description = String(cache?.frontmatter?.description ?? "");
                }
            }
            notesForMoc.push({
                path: r.path,
                title: r.title,
                description,
                score: r.score,
                embedding: Array.from(noteVec),
                tier: r.tier,
                tags: r.tags,
            });
        }

        console.debug("[MOC 2.0] notesForMoc after assembly:", notesForMoc.length,
            "out of", results.length, "results");
        if (dimMismatchCount > 0) {
            console.warn(`[MOC 2.0] skipped ${dimMismatchCount} notes with mismatched embedding dim (canonical=${canonicalDim}). Re-index to recover.`);
            // Surface to the user — they won't open devtools but they
            // should know mixed-dim state explains the smaller MOC.
            new Notice(t.dimMismatchNotice(dimMismatchCount), 10000);
        }
        if (notesForMoc.length < 5) {
            console.warn("[MOC 2.0] too few notesForMoc. Missing in store:", missingPaths);
            new Notice(t.mocTooFewResults);
            await this.buildMocFlatFromCurrentTab();
            return;
        }

        const progress = new Notice(t.mocClusteringStatus(0, notesForMoc.length), 0);
        const onStage = (stage: "clustering" | "naming", current: number, total: number) => {
            const text = stage === "clustering"
                ? t.mocClusteringStatus(current, total)
                : t.mocNamingStatus(current, total);
            progress.setMessage(text);
        };

        try {
            const result = await generateMocGrouped({
                notes: notesForMoc,
                query,
                settings: this.plugin.settings,
                onStage,
            });
            progress.hide();

            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
            const timeStr = now.toTimeString().slice(0, 5).replace(":", "");
            const fileName = `MOC-${dateStr}-${timeStr}-grouped.md`;

            const content = renderMocGrouped(result, notesForMoc);
            const existing = this.app.vault.getAbstractFileByPath(fileName);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, content);
            } else {
                await this.app.vault.create(fileName, content);
            }

            new Notice(t.mocCreated(fileName));

            const file = this.app.vault.getAbstractFileByPath(fileName);
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf(false).openFile(file);
            }
        } catch (err) {
            progress.hide();
            if (err instanceof FallbackToFlatError) {
                console.debug("[MOC 2.0] clustering degenerate, falling back to flat");
                new Notice(t.mocClusteringDegenerate);
                await this.buildMocFlatFromCurrentTab();
                return;
            }
            console.error("Vault Curate: MOC 2.0 generation failed", err);
            new Notice(t.mocLlmUnavailable);
        }
    }

    private async buildMoc(results: SearchResult[], source: string) {
        if (results.length === 0) {
            new Notice(t.mocNoResults);
            return;
        }

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
        const timeStr = now.toTimeString().slice(0, 5).replace(":", "");
        const fileName = `MOC-${dateStr}-${timeStr}.md`;

        // Build a descriptive title from source context
        let mocTitle = `MOC ${now.toISOString().slice(0, 10)}`;
        let mocDesc = "";
        if (source === "search" && this.currentQuery) {
            mocTitle = t.mocTitleSearch(this.currentQuery);
            mocDesc = t.mocDescSearch(this.currentQuery);
        } else if (source.startsWith("discover-current")) {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const stored = this.plugin.store?.getNote(activeFile.path);
                const noteTitle = stored?.title ?? activeFile.basename;
                mocTitle = t.mocTitleRelated(noteTitle);
                mocDesc = t.mocDescRelated(noteTitle);
            }
        } else if (source === "discover-global") {
            mocTitle = t.mocTitleGlobal;
            mocDesc = t.mocDescGlobal;
        }

        // Build MOC content
        const lines: string[] = [];
        lines.push("---");
        lines.push(`title: ${JSON.stringify(mocTitle)}`);
        lines.push(`description: ${JSON.stringify(mocDesc)}`);
        lines.push(`pubDate: ${formatLocalDateTime(now)}`);
        lines.push("category: MOC");
        lines.push("tags:");
        lines.push("  - MOC");
        lines.push(`  - ${source}`);
        lines.push("---");
        lines.push("");
        lines.push(`# ${mocTitle}`);
        lines.push("");

        // Group by tier
        const hot = results.filter(r => r.tier === "hot");
        const cold = results.filter(r => r.tier === "cold");

        if (hot.length > 0) {
            lines.push("## Hot");
            lines.push("");
            for (const r of hot) {
                const preview = await this.getPreviewForResult(r);
                lines.push(`- ${toWikilink(r.path, r.title)} (${r.score.toFixed(2)}) — ${preview}`);
                lines.push("");
            }
        }

        if (cold.length > 0) {
            lines.push("## Cold");
            lines.push("");
            for (const r of cold) {
                const preview = await this.getPreviewForResult(r);
                lines.push(`- ${toWikilink(r.path, r.title)} (${r.score.toFixed(2)}) — ${preview}`);
                lines.push("");
            }
        }

        // Write file
        const content = lines.join("\n");
        const existingFile = this.app.vault.getAbstractFileByPath(fileName);
        if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, content);
        } else {
            await this.app.vault.create(fileName, content);
        }

        new Notice(t.mocCreated(fileName));

        // Open the MOC
        const file = this.app.vault.getAbstractFileByPath(fileName);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf(false).openFile(file);
        }
    }

    private async getPreviewForResult(result: SearchResult): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(result.path);
        if (!(file instanceof TFile)) return "";
        return await getContentPreview(this.app, file, 80);
    }

    // ── Shared result item (click + right-click menu + drag to Canvas) ──

    private createResultItem(parent: HTMLElement, result: SearchResult, dismiss?: DismissContext) {
        const item = parent.createDiv({ cls: "vault-curate-result-item" });

        // Click → open file. Keymap.isModEvent maps Obsidian's conventions:
        // Cmd/Ctrl+click → new tab, +Alt → split, +Shift → window (issue #8).
        const openFile = (paneType: PaneType | boolean) => {
            const file = this.app.vault.getAbstractFileByPath(result.path);
            if (file instanceof TFile) {
                void this.app.workspace.getLeaf(paneType).openFile(file);
            }
        };
        item.addEventListener("click", (e) => openFile(Keymap.isModEvent(e)));
        // Middle-click never fires "click"; the in-row buttons (✕ / generate
        // description) only swallow "click", so exclude them here explicitly.
        item.addEventListener("auxclick", (e) => {
            if (e.button !== 1) return;
            if (e.target instanceof Element && e.target.closest("button")) return;
            openFile("tab");
        });

        // Hover → trigger Obsidian native Page Preview (gated by Cmd/Ctrl
        // modifier per registerHoverLinkSource defaultMod:true in main.ts).
        item.addEventListener("mouseover", (event) => {
            this.app.workspace.trigger("hover-link", {
                event,
                source: "vault-curate",
                hoverParent: this,
                targetEl: item,
                linktext: result.path,
                sourcePath: result.path,
            });
        });

        // Right-click → native file context menu (Bookmark, Open in new tab, etc.)
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = this.app.vault.getAbstractFileByPath(result.path);
            if (!(file instanceof TFile)) return;
            const menu = new Menu();
            this.app.workspace.trigger("file-menu", menu, file, "vault-curate", this.leaf);
            menu.showAtMouseEvent(e);
        });

        // Drag → Canvas / other drop targets (dragManager is not in public API)
        const file = this.app.vault.getAbstractFileByPath(result.path);
        if (file instanceof TFile && this.app.dragManager) {
            this.app.dragManager.handleDrag(item, (dragEvent: DragEvent) => {
                return this.app.dragManager.dragFile(dragEvent, file, "vault-curate");
            });
        }

        renderResultItem(item, result, this.app);
        this.maybeAddGenerateDescriptionButton(item, result);
        if (dismiss) this.addDismissButton(item, result, dismiss);
    }

    /** 013 D4/D11: hover ✕ — "don't suggest this again". Only rows with a
     *  DismissContext get one; the Search tab passes none (驗收 10). */
    private addDismissButton(item: HTMLElement, result: SearchResult, dismiss: DismissContext) {
        const btn = item.createEl("button", {
            text: "✕",
            cls: "vc-result-dismiss",
            attr: { "aria-label": t.dismissTooltip, title: t.dismissTooltip },
        });
        btn.addEventListener("click", (e) => {
            // The parent row's click handler opens the file — swallow it.
            e.stopPropagation();
            if (dismiss.kind === "pair") {
                this.plugin.settings.dismissedPairs[pairKey(dismiss.anchor, result.path)] = Date.now();
            } else {
                this.plugin.settings.dismissedNotes[result.path] = Date.now();
            }
            void this.plugin.saveSettings();
            if (dismiss.kind === "note") {
                this.removeNoteFromGroups(result.path);
            } else {
                this.lastDiscoverResults = this.lastDiscoverResults.filter((r) => r.path !== result.path);
                item.remove();
            }
            new Notice(t.dismissedNotice);
        });
    }

    /**
     * Phase 6 (004 rebrand): Discover/Search rows for notes without a
     * description get a small "Generate description" button — solves the
     * discoverability gap left when the auto pipeline was removed (D7).
     */
    private maybeAddGenerateDescriptionButton(item: HTMLElement, result: SearchResult) {
        if (!this.plugin.settings.enableAICuration) return;
        const file = this.app.vault.getAbstractFileByPath(result.path);
        if (!(file instanceof TFile)) return;
        const cache = this.app.metadataCache.getFileCache(file);
        const fm: Record<string, unknown> | undefined = cache?.frontmatter;
        const desc = fm?.description;
        if (typeof desc === "string" && desc.trim().length > 0) return;

        const btn = item.createEl("button", {
            text: t.btnDescGenerate,
            cls: "vault-curate-desc-btn",
        });
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            void (async () => {
                btn.setAttribute("disabled", "true");
                btn.setText(t.descGenerating(0, 1));
                const ok = await this.plugin.descGenerator.generateForActiveNote(file);
                if (ok) {
                    btn.remove();
                } else {
                    btn.removeAttribute("disabled");
                    btn.setText(t.btnDescGenerate);
                }
            })();
        });
    }
}
