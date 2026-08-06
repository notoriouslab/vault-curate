import { FileView, Menu, normalizePath, Notice, Platform, Plugin, TFile, TFolder, requestUrl } from "obsidian";
import workerSource from "@inline/worker";
import { SQLiteStore, type PersistAdapter } from "./storage/SQLiteStore";
import { DENOISE_VERSION } from "./indexer/denoise";
import { T2S_VERSION } from "./indexer/preproc";
import {
    createProvider,
    type EmbeddingProvider,
    type EmbeddingSettings,
    type HttpFetch,
} from "./embedding";
import {
    VaultSearchData,
    VaultSearchSettings,
    DEFAULT_SETTINGS,
    SearchResult,
} from "./types";
import { Indexer } from "./indexer";
import { SearchModal } from "./searcher";
import { searchHybrid } from "./search/searchHybrid";
import { SearchView, VIEW_TYPE_SEARCH } from "./search-view";
import { VaultSearchSettingTab } from "./settings";
import { findSimilarSqlite } from "./search/discoverSqlite";
import { buildGraphCanvas, graphCanvasFileName, type CanvasJson } from "./canvas/graphCanvas";
import { buildPathCanvas, pathCanvasFileName } from "./canvas/pathCanvas";
import { expandCanvas, CROWDED_NODE_COUNT, type ExpandResult } from "./canvas/expandCanvas";
import {
    widestPath,
    DEFAULT_KNN_K,
    DEFAULT_MAX_HOPS,
    KNN_SAME_FOLDER_CAP,
} from "./search/semanticPath";
import { PathTargetModal } from "./ui/PathTargetModal";
import { PromoteModal } from "./ui/PromoteModal";
import { collectPurpleEdges, promoteEdgesInCanvas, pairKey, type PurplePair } from "./canvas/promote";
import { insertRelatedLink } from "./utils/insertRelatedLink";
import { mergeSettings } from "./utils/mergeSettings";
import { renameInDismissed, deleteFromDismissed } from "./utils/dismissMaintenance";
import { createWriteQueue } from "./utils/writeQueue";
import { KnnGraphManager } from "./search/knnGraphManager";
import knnWorkerSource from "@inline/knn-worker";
import { makeTierResolver, resolveCreated } from "./heat/makeTierResolver";
import { MobileIndexGate, type MobileGateState } from "./mobile/indexGate";
import { probeStoreHealth } from "./mobile/probeStoreHealth";
import { isLoopbackHost } from "./utils";
import { SELF_WRITE_TOLERANCE_MS, type TierResolver } from "./heat/deriveTier";
import { relatedKwRank, kwRankForQuery } from "./search/relatedKwRank";
import { parseTags } from "./search/relatedFusion";
import { buildProfile, profileCentroid, type ProfileCandidate } from "./search/globalProfile";
import { DescriptionGenerator } from "./description-generator";
import { OnboardingModal, applyOnboardingChoice } from "./ui/OnboardingModal";
import { loadWasmAsset } from "./runtime/wasmAssets";
import { t } from "./i18n";

const SQL_WASM_URL =
    "https://github.com/notoriouslab/vault-curate/releases/latest/download/sql-wasm.wasm";
const ORT_WASM_URL =
    "https://github.com/notoriouslab/vault-curate/releases/latest/download/ort-wasm-simd-threaded.wasm";

export default class VaultSearchPlugin extends Plugin {
    settings!: VaultSearchSettings;
    indexer!: Indexer;
    descGenerator!: DescriptionGenerator;
    store: SQLiteStore | null = null;
    provider: EmbeddingProvider | null = null;
    /** 015 D4: mobile query-intent loading gate (null on desktop). State
     *  lives here, not in the view — reopening the sidebar reads the same
     *  gate; the view only renders it. */
    private mobileGate: MobileIndexGate<SQLiteStore> | null = null;
    private sqlWasmBinary: Uint8Array | null = null;
    /** 014: k-NN graph lifecycle — worker full builds, main-thread
     *  incremental maintenance, revision backstop. Replaces the 009
     *  whole-graph knnCache (which any single edit invalidated). */
    private knnManager = new KnnGraphManager({
        spawnWorker: () => this.spawnKnnWorker(),
        k: DEFAULT_KNN_K,
        sameFolderCap: KNN_SAME_FOLDER_CAP,
        isBulkIndexing: () => this.indexer?.indexing ?? false,
    });
    private ortWasmBinary: ArrayBuffer | null = null;
    private debounceTimers: Map<string, number> = new Map();
    /** 013 D10: serializes saveSettings writes (one in flight). */
    private saveQueue = createWriteQueue();
    /** Debounce for the background BM25 warm (011 perf follow-up). */
    private bm25WarmTimer: number | null = null;
    /** 010 D6: self-write exemption ledger — mtimes of the plugin's own
     *  batch writes (description generator). Persisted in data.json,
     *  pruned once an entry falls outside the hotDays window. Promote
     *  writes are deliberately NOT recorded (user judgment). */
    selfWrites: Record<string, number> = {};

    async onload() {
        await this.loadSettings();

        // Phase 4 (004 rebrand): open SQLite store + create embedding provider.
        // Wrap in try/catch so a backend failure cannot prevent the plugin
        // from registering its commands — diagnostics belong in the console,
        // not a dead palette.
        //
        // Step 1: pre-fetch sql.js + ort-web WASM bytes via Obsidian's
        // `requestUrl` (CORS bypass) and cache them in the plugin folder.
        // Both runtimes accept the raw bytes (`wasmBinary` option) instead
        // of a URL, so they never trigger browser-level fetches that
        // `app://obsidian.md` is not permitted to make against github.com.
        if (Platform.isMobile) {
            // 015 D4: query-intent loading — onload does no heavy work at all.
            // The index (and sql-wasm) load on first search/discover via
            // ensureStoreLoaded(); the provider decision is a pure settings
            // read (layer 0 = null unless a non-loopback remote is set).
            try {
                this.provider = this.buildMobileProvider();
            } catch (err) {
                console.warn("vault-curate: mobile provider unavailable — keyword-only search", err);
                this.provider = null;
            }
        } else {
            try {
                const sqlWasm = await loadWasmAsset(this, "sql-wasm.wasm", SQL_WASM_URL);
                this.sqlWasmBinary = sqlWasm;
                const ortWasm = await loadWasmAsset(
                    this,
                    "ort-wasm-simd-threaded.wasm",
                    ORT_WASM_URL,
                );
                // Copy into a fresh ArrayBuffer (Uint8Array.buffer may be a
                // SharedArrayBuffer in some runtimes; postMessage transfer list
                // and ORT's wasmBinary both expect ArrayBuffer).
                const ortAb = new ArrayBuffer(ortWasm.byteLength);
                new Uint8Array(ortAb).set(ortWasm);
                this.ortWasmBinary = ortAb;

                this.store = await this.openStore();
                this.provider = await this.buildProvider();
                this.indexer = new Indexer(this, this.store, this.provider);
                // 014 D8: feed single-file mutations to the k-NN graph maintainer.
                this.indexer.onMutation = (type, path) => {
                    if (this.store) this.knnManager.onMutation(type, path, this.store);
                };
            } catch (err) {
                console.error("vault-curate: backend init failed", err);
                new Notice(
                    `vault-curate: backend init failed — ${err instanceof Error ? err.message : String(err)}`,
                    10000,
                );
            }
        }
        this.descGenerator = new DescriptionGenerator(this);

        // Register sidebar view
        this.registerView(VIEW_TYPE_SEARCH, (leaf) => new SearchView(leaf, this));

        // Register as a hover-link source so Search/Discover result items
        // can integrate with Obsidian's native Page Preview core plugin.
        // defaultMod=true means user holds Cmd/Ctrl while hovering — matches
        // the convention used by Obsidian's own [[wikilink]] previews.
        this.registerHoverLinkSource("vault-curate", {
            defaultMod: true,
            display: "Vault Curate",
        });

        // Ribbon icon to open sidebar
        this.addRibbonIcon("compass", t.viewDisplayName, () => {
            void this.activateView();
        });

        // Register commands
        this.addCommand({
            id: "semantic-search",
            name: t.cmdSemanticSearch,
            callback: () => {
                // 015: mobile searches without a provider (BM25 + fuzzy);
                // opening the modal is query intent — kick the index gate so
                // typed queries start working as soon as the store lands.
                if (Platform.isMobile) {
                    void this.ensureStoreLoaded().catch(() => { /* gate state renders in sidebar */ });
                } else if (!this.store || !this.provider) {
                    new Notice(t.noticeIndexEmpty);
                    return;
                }
                new SearchModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: "open-search-panel",
            name: t.cmdOpenPanel,
            callback: () => this.activateView(),
        });

        this.addCommand({
            id: "find-similar",
            name: t.cmdFindSimilar,
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                // 015: on mobile the index loads on demand — the command
                // stays visible and triggers the gate.
                if (!this.store && !Platform.isMobile) return false;
                if (checking) return true;
                void this.runMobileQuery(() => this.findSimilar(file));
                return true;
            },
        });

        // Semantic Canvas Graph (006): same guard shape as find-similar.
        this.addCommand({
            id: "generate-graph-canvas",
            name: t.cmdGenerateGraph,
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                // 015: on mobile the index loads on demand — the command
                // stays visible and triggers the gate.
                if (!this.store && !Platform.isMobile) return false;
                if (checking) return true;
                void this.runMobileQuery(() => this.generateGraphCanvas(file));
                return true;
            },
        });

        // Semantic Path (009): current note → picked destination, widest
        // chain rendered as a linear Canvas. The k-NN graph builds on
        // demand inside the handler — never on startup/update paths.
        this.addCommand({
            id: "generate-semantic-path",
            name: t.cmdSemanticPath,
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                // 015: on mobile the index loads on demand — the command
                // stays visible and triggers the gate.
                if (!this.store && !Platform.isMobile) return false;
                if (checking) return true;
                void this.runMobileQuery(() => this.generateSemanticPath(file));
                return true;
            },
        });

        // 015 D5: index writing is desktop-only — not registered on mobile.
        if (!Platform.isMobile) {
            this.addCommand({
                id: "rebuild-index",
                name: t.cmdRebuild,
                callback: () => this.rebuildIndex(),
            });

            this.addCommand({
                id: "update-index",
                name: t.cmdUpdate,
                callback: () => this.updateIndex(),
            });
        }

        // Phase 6 (004 rebrand): description generation is now per-note,
        // gated by enableAICuration. checkCallback hides the command from
        // the palette when the gate is off or no markdown file is active.
        this.addCommand({
            id: "desc-active-note",
            name: t.cmdDescActive,
            checkCallback: (checking) => {
                if (Platform.isMobile) return false; // 015 D5: LLM flows are desktop-only
                if (!this.settings.enableAICuration) return false;
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                if (checking) return true;
                void this.descGenerator.generateForActiveNote(file);
                return true;
            },
        });

        this.addCommand({
            id: "desc-current-results",
            name: t.cmdDescSelected,
            checkCallback: (checking) => {
                if (Platform.isMobile) return false; // 015 D5: LLM flows are desktop-only
                // Gate on AI curation only. Empty/no-sidebar runtime check
                // happens in the handler so the command is discoverable
                // before the user has searched anything.
                if (!this.settings.enableAICuration) return false;
                if (checking) return true;
                const view = this.getReadySearchView();
                if (!view) {
                    new Notice(t.descOpenSidebarFirst);
                    return true;
                }
                if (view.getCurrentResults().length === 0) {
                    new Notice(t.descNoEligible);
                    return true;
                }
                void this.generateDescriptionsForResults(view);
                return true;
            },
        });

        // Phase 6/8: right-click items on any .md file in the file
        // explorer or editor. "Find similar" always shows when an index
        // exists; "Generate description" is gated on enableAICuration.
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file) => {
                // Purple-edge promotion (010 D1): right-click on a .canvas
                // file (tab header / file explorer).
                // 015 D5: promote is desktop-only (checkbox dialog +
                // hover-preview UX, writes into note bodies).
                if (file instanceof TFile && file.extension === "canvas" && this.store && !Platform.isMobile) {
                    menu.addItem((item) => {
                        item.setTitle(t.menuPromote)
                            .setIcon("link")
                            .onClick(() => void this.promotePurpleEdges(file));
                    });
                    return;
                }
                if (!(file instanceof TFile) || file.extension !== "md") return;
                // 015: mobile items stay visible pre-load — the gate loads
                // the index on first use (runMobileQuery).
                if (this.store || Platform.isMobile) {
                    menu.addItem((item) => {
                        item.setTitle(t.menuFindSimilar)
                            .setIcon("search")
                            .onClick(() => void this.runMobileQuery(() => this.findSimilar(file)));
                    });
                    menu.addItem((item) => {
                        item.setTitle(t.menuGenerateGraph)
                            .setIcon("git-fork")
                            .onClick(() => void this.runMobileQuery(() => this.generateGraphCanvas(file)));
                    });
                    menu.addItem((item) => {
                        item.setTitle(t.menuSemanticPath)
                            .setIcon("route")
                            .onClick(() => void this.runMobileQuery(() => this.generateSemanticPath(file)));
                    });
                    // 009 D5: expansion targets the OPEN canvas. The
                    // canvas file is captured HERE, at menu-build time —
                    // right-clicking a canvas node focuses it, which can
                    // flip getActiveFile() to the node's .md before the
                    // menu item's onClick runs (dogfood: silent no-op).
                    const activeCanvas = this.getActiveCanvasFile();
                    if (activeCanvas) {
                        menu.addItem((item) => {
                            item.setTitle(t.menuExpandInCanvas)
                                .setIcon("expand")
                                .onClick(() => void this.runMobileQuery(() => this.expandInCanvas(file, activeCanvas)));
                        });
                    }
                }
                if (this.settings.enableAICuration && !Platform.isMobile) { // 015 D5: LLM flows desktop-only
                    menu.addItem((item) => {
                        item.setTitle(t.menuDescGenerate)
                            .setIcon("sparkles")
                            .onClick(() => void this.descGenerator.generateForActiveNote(file));
                    });
                }
            }),
        );

        this.addCommand({
            id: "global-discover",
            name: t.cmdGlobalDiscover,
            callback: () => void this.runMobileQuery(() => this.openGlobalDiscover()),
        });

        // Purple-edge promotion (010): only offered while a canvas is the
        // active file and an index exists.
        this.addCommand({
            id: "promote-purple-edges",
            name: t.cmdPromote,
            checkCallback: (checking) => {
                if (Platform.isMobile) return false; // 015 D5: desktop-only
                const canvasFile = this.getActiveCanvasFile();
                if (!canvasFile || !this.store) return false;
                if (checking) return true;
                void this.promotePurpleEdges(canvasFile);
                return true;
            },
        });

        this.addCommand({
            id: "generate-moc-grouped",
            name: t.cmdGenerateMocGrouped,
            checkCallback: (checking) => {
                if (Platform.isMobile) return false; // 015 D5: LLM flows are desktop-only
                // Gate on AI curation only. The grouped flow has its own
                // fallback-to-flat path when result count < 5, so we keep
                // the command discoverable regardless of current results.
                if (!this.settings.enableAICuration) return false;
                if (checking) return true;
                const view = this.getReadySearchView();
                if (!view) {
                    new Notice(t.descOpenSidebarFirst);
                    return true;
                }
                void view.generateMocGroupedFlow();
                return true;
            },
        });

        // Active Discovery: file-open listener
        this.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                if (!file || !this.store) return;
                this.onActiveFileChange(file);
            })
        );

        // Register vault events for auto-indexing.
        // Defer to `onLayoutReady` so we don't catch the synthetic `create`
        // events that Obsidian emits for every existing file during workspace
        // load — those would otherwise queue 300+ single-file index calls and
        // saturate the embedding provider on plugin enable.
        this.app.workspace.onLayoutReady(() => {
            // 011 perf follow-up: warm the BM25 index shortly after startup
            // (sliced, background) so the first Discover already fuses.
            this.scheduleBM25Warm(3000);
            this.registerEvent(
                this.app.vault.on("modify", (file) => this.onFileChange(file, "modify"))
            );
            this.registerEvent(
                this.app.vault.on("create", (file) => this.onFileChange(file, "create"))
            );
            this.registerEvent(
                this.app.vault.on("delete", (file) => {
                    if (file instanceof TFile) this.notifyPinOnFileDelete(file.path);
                    this.onFileChange(file, "delete");
                    // 013 D7: unconditional branch — the event fires once
                    // for a FOLDER too, and onFileChange early-outs on
                    // non-TFile, so this must not ride inside either guard.
                    this.maintainDismissedOnDelete(file.path);
                })
            );
            this.registerEvent(
                this.app.vault.on("rename", (file, oldPath) => {
                    if (file instanceof TFile) this.notifyPinOnFileRename(file);
                    void this.onFileRename(file, oldPath);
                    // 013 D7: unconditional branch (see delete handler).
                    this.maintainDismissedOnRename(oldPath, file.path);
                })
            );
        });

        // Settings tab
        this.addSettingTab(new VaultSearchSettingTab(this.app, this));

        // Phase 8 (004 rebrand) first-launch onboarding. The modal pops
        // when both signals are absent:
        //   - last_indexed_at  → set by the indexer on first successful rebuild
        //   - onboarding_dismissed → set when the user clicks Skip / Esc / X
        // Either signal alone is enough to stop bouncing the modal each launch.
        // If store init failed, surface a recovery notice rather than going
        // silent.
        this.app.workspace.onLayoutReady(() => {
            if (!this.store) {
                // 015: a null store is the mobile default (query-intent
                // loading) — the sidebar renders gate state instead of a
                // launch-time notice. Desktop keeps the loud recovery hint.
                if (!Platform.isMobile) {
                    new Notice("vault-curate: backend not ready — reload the plugin or check console.", 10000);
                }
                return;
            }
            const indexed = this.store.getMeta("last_indexed_at");
            const dismissed = this.store.getMeta("onboarding_dismissed");
            // 015: onboarding is a desktop flow (its first line writes meta;
            // mobile is read-only and index-less setup makes no sense there).
            if (!indexed && !dismissed && !Platform.isMobile) {
                this.showOnboardingModal();
            }
            // 007 D2: upgrade re-embed scans live at the top of update(), but
            // nothing ever called update() on startup — an upgraded plugin
            // would never run them (real-vault dogfood finding). Kick one
            // incremental update when the denoise rule set version is stale
            // OR descriptions await their backfill embedding (007 D4 —
            // schema v3 upgrade leaves existing desc_vec NULL). Bonus: the
            // pre-existing tokenizer/model rebuild checks at the top of
            // update() get a startup trigger through the same call.
            const denoiseStale = this.store.getMeta("denoise_version") !== DENOISE_VERSION;
            const t2sStale = this.store.getMeta("t2s_version") !== T2S_VERSION;
            const descPending = this.store.countDescBackfillPending(this.settings.minDescChars) > 0;
            // 015: staleness auto-update is a full-embed write path — desktop only.
            if (indexed && !Platform.isMobile && (denoiseStale || t2sStale || descPending)) {
                console.debug(`vault-curate: upgrade work pending (denoiseStale=${denoiseStale}, t2sStale=${t2sStale}, descBackfill=${descPending}) — kicking incremental update`);
                void this.updateIndex();
            }
        });
        console.debug("Vault Curate loaded");
    }
    onunload() {
        for (const timer of this.debounceTimers.values()) {
            window.clearTimeout(timer);
        }
        if (this.activeDiscoverTimer) window.clearTimeout(this.activeDiscoverTimer);
        if (this.bm25WarmTimer !== null) window.clearTimeout(this.bm25WarmTimer);
        // Best-effort flush + dispose. We cannot await in onunload, but
        // SQLiteStore.dispose() flushes synchronously when pending mutations.
        void this.store?.dispose();
        this.provider?.dispose();
        this.knnManager.dispose(); // 014: terminate in-flight build + free matrix
        console.debug("Vault Curate unloaded");
    }

    /** Public — also called from Settings → AI Curation → "Re-run onboarding". */
    showOnboardingModal() {
        // Clear the dismissed flag so a Skip from this re-run doesn't stick.
        this.store?.setMeta("onboarding_dismissed", "");
        new OnboardingModal(this.app, this, (choice) => {
            void applyOnboardingChoice(this, choice);
        }).open();
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_SEARCH)[0];
        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({ type: VIEW_TYPE_SEARCH, active: true });
            }
        }
        if (leaf) {
            void workspace.revealLeaf(leaf);
            // Focus the search input (skip if view is still deferred)
            const view = leaf.view instanceof SearchView ? leaf.view : null;
            view?.focusInput?.();
        }
    }

    // ── Active Discovery ────────────────────────────────

    private activeDiscoverTimer: number | null = null;
    private lastDiscoverPath: string | null = null;

    /** Notify every SearchView leaf that a file was deleted so it can
     *  auto-unpin if that file was its pinnedFile (D3 edge case b). */
    private notifyPinOnFileDelete(path: string) {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH)) {
            if (leaf.view instanceof SearchView) {
                leaf.view.handleFileDeleted(path);
            }
        }
    }

    /** Notify every SearchView leaf that a file was renamed so it can
     *  re-render the pin status line with the new basename (D3 edge case a).
     *  Obsidian has already updated TFile.path on the same instance. */
    private notifyPinOnFileRename(file: TFile) {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH)) {
            if (leaf.view instanceof SearchView) {
                leaf.view.handleFileRenamed(file);
            }
        }
    }

    private onActiveFileChange(file: TFile) {
        if (file.extension !== "md") return;
        if (file.path === this.lastDiscoverPath) return;
        if (this.activeDiscoverTimer) window.clearTimeout(this.activeDiscoverTimer);
        if (this.bm25WarmTimer !== null) window.clearTimeout(this.bm25WarmTimer);
        this.activeDiscoverTimer = window.setTimeout(() => {
            // Skip refresh if any SearchView leaf has Discover pinned (D3 A2:
            // global guard — any pinned leaf blocks file-open refresh). Do NOT
            // update lastDiscoverPath here so subsequent unpin re-evaluates.
            const anyPinned = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH)
                .some(leaf => leaf.view instanceof SearchView && leaf.view.isPinned());
            if (anyPinned) return;

            this.lastDiscoverPath = file.path;
            // Skip silently when the sidebar leaf isn't mounted yet or its
            // view is still deferred — Active Discovery only makes sense
            // when the user has already opened the panel.
            const view = this.getReadySearchView();
            if (view && view.isDiscoverTabActive()) {
                void view.discoverForFile(file);
            }
        }, 500);
    }

    private async openGlobalDiscover() {
        if (!this.store) {
            new Notice(t.discoverNoIndex);
            return;
        }
        await this.activateView();
        const view = this.getReadySearchView();
        if (!view) return;
        view.showGlobalDiscover();
    }

    /**
     * Phase 6: batch-generate descriptions for the current search/Discover
     * results panel. Skips notes that already have a description; opens a
     * Notice if nothing is eligible so the user isn't left wondering.
     */
    async generateDescriptionsForResults(view: SearchView): Promise<void> {
        const results = view.getCurrentResults();
        const targets: TFile[] = [];
        let skippedNonString = 0;
        for (const r of results) {
            const file = this.app.vault.getAbstractFileByPath(r.path);
            if (!(file instanceof TFile) || file.extension !== "md") continue;
            const cache = this.app.metadataCache.getFileCache(file);
            const fm: Record<string, unknown> | undefined = cache?.frontmatter;
            const desc = fm?.description;
            if (desc === undefined || desc === null) {
                targets.push(file);
            } else if (typeof desc === "string") {
                if (desc.trim().length === 0) targets.push(file);
                // non-empty string description → skip (already curated)
            } else {
                // Number, array, object — non-standard. Skip to avoid
                // overwriting structured data the user might be relying on.
                skippedNonString++;
            }
        }
        if (skippedNonString > 0) {
            console.warn(`vault-curate: skipped ${skippedNonString} notes whose existing description is not a string (would clobber structured data).`);
        }
        if (targets.length === 0) {
            new Notice(t.descNoEligible);
            return;
        }
        await this.descGenerator.generateForFiles(targets);
    }

    // ── Find Similar (Phase 8: SQLite-backed) ────────────

    async findSimilar(file: TFile) {
        const store = this.store;
        if (!store) {
            new Notice(t.noticeIndexEmpty);
            return;
        }
        const note = store.getNote(file.path);
        if (!note || note.bodyVec.length === 0) {
            new Notice(t.notIndexed);
            return;
        }

        const topResults = findSimilarSqlite(file.path, store, {
            minScore: this.settings.minScore,
            topResults: this.settings.topResults,
            sameFolderCap: this.settings.sameFolderCap,
            tierResolver: this.tierResolver(),
            kwRank: this.relatedKwRankFor(file),
            dismissedPairs: this.settings.dismissedPairs,
        });

        if (topResults.length === 0) {
            new Notice(t.noSimilar);
            return;
        }

        await this.activateView();
        const view = this.getReadySearchView();
        if (view) {
            view.showResults(topResults, t.similarTo(note.title), file.path);
        }
    }

    /**
     * Public entrypoint for `obsidian eval` / external scripting: run the full
     * hybrid search (BM25 + semantic + fuzzy title, RRF-fused) and return the
     * ranked results. Reach from the Obsidian CLI via:
     *   obsidian eval code="app.plugins.plugins['vault-curate'].search('q').then(r=>JSON.stringify(r))"
     * Scope defaults to "all" (not the GUI's configured scope): programmatic
     * callers expect the whole vault unless they ask otherwise.
     * Throws on invalid input and when the backend (store/provider) isn't
     * ready — the CLI always exits 0, so an empty result must mean
     * "no matches", never "not ready" or "bad arguments".
     */
    async search(
        query: string,
        opts?: { scope?: "hot" | "cold" | "all" },
    ): Promise<SearchResult[]> {
        // TS types don't bind external JS callers (obsidian eval) — validate.
        if (typeof query !== "string") {
            throw new Error(`vault-curate: search() query must be a string, got ${typeof query}`);
        }
        const scope = opts?.scope ?? "all";
        if (scope !== "hot" && scope !== "cold" && scope !== "all") {
            throw new Error(`vault-curate: search() scope must be "hot" | "cold" | "all", got ${JSON.stringify(scope)}`);
        }
        // 015: mobile serves keyword+fuzzy search without a provider; desktop
        // keeps treating a missing provider as not-ready (loud, not silent).
        if (!this.store || (!this.provider && !Platform.isMobile)) {
            throw new Error("vault-curate: backend not ready (still initializing, or failed to load — check the app console)");
        }
        return searchHybrid(
            query,
            { store: this.store, provider: this.provider },
            {
                topResults: this.settings.topResults,
                searchScope: scope,
                tierResolver: this.tierResolver(),
            },
        );
    }

    // ── Semantic Canvas Graph (006) ────────────────────

    /** Generate an editable .canvas neighborhood graph for `file` and open
     *  it. Shared by the command palette, file-menu, and Discover sidebar
     *  entries. Never overwrites: each run creates a fresh stamped file. */
    async generateGraphCanvas(file: TFile) {
        const store = this.store;
        if (!store) {
            new Notice(t.noticeIndexEmpty);
            return;
        }
        const note = store.getNote(file.path);
        if (!note || note.bodyVec.length === 0) {
            new Notice(t.notIndexed);
            return;
        }

        const tierResolver = this.tierResolver();
        const neighbors = findSimilarSqlite(file.path, store, {
            minScore: this.settings.minScore,
            topResults: this.settings.topResults,
            sameFolderCap: this.settings.sameFolderCap,
            tierResolver,
            kwRank: this.relatedKwRankFor(file),
            dismissedPairs: this.settings.dismissedPairs,
        });
        if (neighbors.length === 0) {
            new Notice(t.noticeGraphNoResults);
            return;
        }

        const canvas = buildGraphCanvas(
            { path: file.path, tier: tierResolver(file.path) },
            neighbors.map((r) => ({ path: r.path, tier: r.tier, score: r.score })),
            this.app.metadataCache.resolvedLinks,
        );

        const { folder, existingNames } = await this.resolveCanvasFolder();
        const stamp = window.moment().format("YYYYMMDD-HHmmss");
        const name = graphCanvasFileName(normalizePath(file.basename), stamp, existingNames);
        const path = await this.writeAndOpenCanvas(folder, name, canvas);
        new Notice(t.noticeGraphCreated(path));
    }

    /** Resolve the canvas output folder (empty setting = vault root, "/"
     *  is how getAbstractFileByPath addresses the root), create it on
     *  first use, and collect existing child names for de-duplication.
     *  Shared by relation graph (006) and semantic path (009). */
    private async resolveCanvasFolder(): Promise<{ folder: string; existingNames: Set<string> }> {
        const rawFolder = this.settings.canvasFolder.trim();
        const folder = rawFolder ? normalizePath(rawFolder) : "/";
        if (folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }
        const parent = this.app.vault.getAbstractFileByPath(folder);
        const existingNames = new Set<string>();
        if (parent instanceof TFolder) {
            for (const child of parent.children) existingNames.add(child.name);
        }
        return { folder, existingNames };
    }

    private async writeAndOpenCanvas(folder: string, name: string, canvas: CanvasJson): Promise<string> {
        const path = folder === "/" ? name : `${folder}/${name}`;
        const created = await this.app.vault.create(
            path,
            JSON.stringify(canvas, null, "\t"),
        );
        await this.app.workspace.getLeaf(true).openFile(created);
        return path;
    }

    // ── Semantic Path (009) ────────────────────────────

    /** Command / file-menu entry: guard the start note, then let the user
     *  pick a destination among all indexed notes. */
    async generateSemanticPath(file: TFile) {
        const store = this.store;
        if (!store) {
            new Notice(t.noticeIndexEmpty);
            return;
        }
        const note = store.getNote(file.path);
        if (!note || note.bodyVec.length === 0) {
            new Notice(t.notIndexed);
            return;
        }

        const files: TFile[] = [];
        for (const row of store.getAllNotesLight()) {
            const af = this.app.vault.getAbstractFileByPath(row.path);
            if (af instanceof TFile) files.push(af);
        }
        new PathTargetModal(this.app, files, t.pathModalPlaceholder, (target) => {
            void this.buildSemanticPathCanvas(file, target);
        }).open();
    }

    /** 014 D3: per-build worker from the inlined bundle (same Blob URL
     *  pattern as WasmEmbeddingProvider). terminate() is wrapped so the
     *  Blob URL is revoked exactly when the manager discards the worker. */
    private spawnKnnWorker(): Worker {
        const blob = new Blob([knnWorkerSource], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        let worker: Worker;
        try {
            worker = new Worker(url);
        } catch (e) {
            // Constructor threw → the wrapped terminate below never exists
            // to revoke the URL; do it here or every failed spawn leaks a
            // Blob URL (四路總檢 紅隊 W4).
            URL.revokeObjectURL(url);
            throw e;
        }
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
            terminate();
            URL.revokeObjectURL(url);
        };
        return worker;
    }

    private async buildSemanticPathCanvas(from: TFile, to: TFile) {
        const store = this.store;
        if (!store) {
            new Notice(t.noticeIndexEmpty);
            return;
        }
        if (from.path === to.path) {
            new Notice(t.noticePathSameNote);
            return;
        }

        // 014: the manager answers instantly from the maintained resident
        // graph; a full build (first use / backstop) runs in the worker with
        // a live progress Notice + cancel button — the main thread never
        // freezes. The p45 verdict threshold rides along (D4 amendment
        // heritage: below the graph's own percentile → honest "not
        // connected", evidence/option-study.md).
        // Boxed so TS keeps the closure-assigned values visible after await.
        const ui = { notice: null as Notice | null, progressEl: null as HTMLSpanElement | null };
        let lastPaint = 0;
        const outcome = await this.knnManager.getGraph(store, {
            onBuildStart: (total) => {
                // Fragment built ONCE — progress updates only touch the
                // retained span, so the cancel button keeps its listener.
                const frag = createFragment();
                ui.progressEl = frag.createSpan({ text: t.noticePathProgress(total, 0) });
                const btn = frag.createEl("button", {
                    text: t.noticePathCancel,
                    cls: "vault-curate-knn-cancel",
                });
                btn.addEventListener("click", () => this.knnManager.cancel());
                ui.notice = new Notice(frag, 0);
            },
            onProgress: (done, total) => {
                const nowMs = Date.now();
                if (nowMs - lastPaint < 500) return; // ≤2Hz (驗收 9)
                lastPaint = nowMs;
                ui.progressEl?.setText(t.noticePathProgress(total, Math.round((done / total) * 100)));
            },
            onFallback: async () => {
                // The sync O(N²) sweep is about to freeze the main thread —
                // surface it and let the Notice paint first (30ms, same as
                // the 1.4.0 flow this path degrades to).
                if (ui.progressEl) ui.progressEl.setText(t.noticePathFallbackBuilding);
                else ui.notice = new Notice(t.noticePathFallbackBuilding, 0);
                await new Promise((resolve) => window.setTimeout(resolve, 30));
            },
        });
        ui.notice?.hide();
        if (outcome.cancelled) {
            new Notice(t.noticePathCancelled);
            return;
        }
        if (outcome.fallback) new Notice(t.noticePathFallback);
        const { graph, threshold } = outcome;

        const result = widestPath(graph, from.path, to.path, DEFAULT_MAX_HOPS);
        if (!result) {
            new Notice(t.noticePathNotConnected(DEFAULT_KNN_K, DEFAULT_MAX_HOPS));
            return;
        }
        if (result.bottleneck < threshold) {
            new Notice(t.noticePathWeak(result.bottleneck, threshold));
            return;
        }

        const tierResolver = this.tierResolver();
        const chain = result.path.map((p) => ({
            path: p,
            tier: tierResolver(p),
        }));
        const canvas = buildPathCanvas(chain, result.sims, this.app.metadataCache.resolvedLinks);

        try {
            const { folder, existingNames } = await this.resolveCanvasFolder();
            const stamp = window.moment().format("YYYYMMDD-HHmmss");
            const name = pathCanvasFileName(
                t.pathFilePrefix,
                normalizePath(from.basename),
                normalizePath(to.basename),
                stamp,
                existingNames,
            );
            const path = await this.writeAndOpenCanvas(folder, name, canvas);
            new Notice(t.noticePathCreated(path));
        } catch (e) {
            // Overlong names, illegal characters, disk failures — surface
            // them instead of dying as an unhandled rejection (red-team).
            console.error("vault-curate: semantic path canvas write failed", e);
            new Notice(t.noticePathCreateFailed);
        }
    }

    // ── In-place canvas expansion (009 D5 mainline) ────

    /** The canvas behind the current view, tolerant of a focused embedded
     *  node editor: getActiveFile() flips to the node's .md while the
     *  active leaf is still the canvas view, so we ask the view first. */
    private getActiveCanvasFile(): TFile | null {
        const view = this.app.workspace.getActiveViewOfType(FileView);
        if (view?.getViewType() === "canvas" && view.file?.extension === "canvas") {
            return view.file;
        }
        const active = this.app.workspace.getActiveFile();
        return active?.extension === "canvas" ? active : null;
    }

    /** Expand `noteFile`'s semantic neighborhood into `canvasFile` (the
     *  canvas open when the menu was built). vault.process re-reads the
     *  live JSON atomically (never a snapshot); the spike showed Obsidian
     *  merges external appends into an open canvas without losing user
     *  edits. */
    async expandInCanvas(noteFile: TFile, canvasFile: TFile) {
        const store = this.store;
        if (!store) {
            new Notice(t.noticeIndexEmpty);
            return;
        }
        const note = store.getNote(noteFile.path);
        if (!note || note.bodyVec.length === 0) {
            new Notice(t.notIndexed);
            return;
        }

        const neighbors = findSimilarSqlite(noteFile.path, store, {
            minScore: this.settings.minScore,
            topResults: this.settings.topResults,
            sameFolderCap: this.settings.sameFolderCap,
            tierResolver: this.tierResolver(),
            kwRank: this.relatedKwRankFor(noteFile),
            dismissedPairs: this.settings.dismissedPairs,
        });
        if (neighbors.length === 0) {
            new Notice(t.noticeExpandNothingNew);
            return;
        }

        let outcome: ExpandResult | null = null;
        try {
            await this.app.vault.process(canvasFile, (data) => {
                const parsed = JSON.parse(data) as CanvasJson;
                const result = expandCanvas(
                    parsed,
                    noteFile.path,
                    neighbors.map((r) => ({ path: r.path, tier: r.tier, score: r.score })),
                    this.app.metadataCache.resolvedLinks,
                );
                outcome = result;
                if (result.added === 0 && result.linkedExisting === 0) return data;
                return JSON.stringify(result.canvas, null, "\t");
            });
        } catch (e) {
            console.error("vault-curate: expand failed", e);
            new Notice(t.noticeExpandFailed);
            return;
        }
        if (!outcome) return;
        const result: ExpandResult = outcome;

        if (result.added === 0 && result.linkedExisting === 0) {
            new Notice(t.noticeExpandNothingNew);
            return;
        }
        new Notice(t.noticeExpandAdded(result.added, result.linkedExisting));
        if (result.collisionUnresolved) new Notice(t.noticeExpandCollision);
        if (result.totalNodes > CROWDED_NODE_COUNT) {
            new Notice(t.noticeExpandCrowded(result.totalNodes));
        }
    }

    async rebuildIndex() {
        if (!this.indexer) {
            new Notice("vault-curate: backend not ready — see console for init error");
            return;
        }
        if (this.indexer.indexing) { new Notice(t.indexingInProgress); return; }
        this.indexer.indexing = true;
        try {
            await this.indexer.rebuild();
        } finally {
            this.indexer.indexing = false;
        }
    }

    async updateIndex() {
        if (!this.indexer) {
            new Notice("vault-curate: backend not ready — see console for init error");
            return;
        }
        if (this.indexer.indexing) { new Notice(t.indexingInProgress); return; }
        this.indexer.indexing = true;
        try {
            await this.indexer.update();
        } finally {
            this.indexer.indexing = false;
        }
    }

    private onFileChange(file: unknown, type: string) {
        if (!this.indexer || !this.store) return;
        if (!this.settings.autoIndex || this.indexer.indexing) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.indexer.shouldExclude(file.path)) return;
        // Skip startup `create` storm: Obsidian re-emits a create event for
        // every existing file when a plugin enables. Only honour incremental
        // events after the user has explicitly run a full rebuild at least
        // once (signalled by meta.bootstrapped — sticky across clearAllData).
        if (!this.store.getMeta("bootstrapped")) return;

        const existing = this.debounceTimers.get(file.path);
        if (existing) window.clearTimeout(existing);

        this.debounceTimers.set(
            file.path,
            window.setTimeout(() => {
                this.debounceTimers.delete(file.path);
                if (type === "delete") {
                    this.indexer.removeNote(file.path);
                } else {
                    void this.indexer.indexSingleFile(file);
                }
            }, 2000)
        );
    }

    private async onFileRename(file: unknown, oldPath: string) {
        if (!this.indexer || !this.store || !this.settings.autoIndex) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (!this.store.getMeta("bootstrapped")) return;

        await this.indexer.renameNote(oldPath, file.path, file);
    }

    // ── Dismissed-records maintenance (013 D7) ─────────
    // Path-keyed judgments rot without this: a renamed pair "comes back",
    // a deleted note leaves a dead entry forever. Only writes when
    // something actually changed, so rename/delete storms of unrelated
    // files don't hammer data.json.

    private static dismissedKeysEqual(a: Record<string, number>, b: Record<string, number>): boolean {
        const ak = Object.keys(a);
        return ak.length === Object.keys(b).length && ak.every((k) => b[k] !== undefined);
    }

    private maintainDismissedOnRename(oldPath: string, newPath: string) {
        const s = this.settings;
        const next = renameInDismissed(s.dismissedPairs, s.dismissedNotes, oldPath, newPath);
        if (VaultSearchPlugin.dismissedKeysEqual(next.pairs, s.dismissedPairs) &&
            VaultSearchPlugin.dismissedKeysEqual(next.notes, s.dismissedNotes)) return;
        s.dismissedPairs = next.pairs;
        s.dismissedNotes = next.notes;
        void this.saveSettings();
    }

    private maintainDismissedOnDelete(path: string) {
        const s = this.settings;
        const next = deleteFromDismissed(s.dismissedPairs, s.dismissedNotes, path);
        if (VaultSearchPlugin.dismissedKeysEqual(next.pairs, s.dismissedPairs) &&
            VaultSearchPlugin.dismissedKeysEqual(next.notes, s.dismissedNotes)) return;
        s.dismissedPairs = next.pairs;
        s.dismissedNotes = next.notes;
        void this.saveSettings();
    }

    /**
     * Return the SearchView instance if the sidebar leaf is mounted AND
     * its view has been instantiated. Obsidian 1.7+ defers sidebar view
     * construction until first reveal, so `leaf.view` can be a
     * `DeferredView` placeholder until then — `getLeavesOfType` returns
     * the leaf, but casting `.view` to SearchView and calling methods on
     * it crashes with "is not a function". Use this helper everywhere
     * we read the SearchView from the workspace.
     */
    private getReadySearchView(): SearchView | null {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH)[0];
        if (!leaf) return null;
        return leaf.view instanceof SearchView ? leaf.view : null;
    }

    /** DB path inside the plugin folder. */
    private dbPath(): string {
        return normalizePath(
            `${this.app.vault.configDir}/plugins/${this.manifest.id}/index.sqlite`
        );
    }

    /** Drop legacy v0.3.x index.json file once the SQLite store is healthy. */
    private async dropLegacyIndexJson(): Promise<void> {
        const legacy = normalizePath(
            `${this.app.vault.configDir}/plugins/${this.manifest.id}/index.json`
        );
        try {
            if (await this.app.vault.adapter.exists(legacy)) {
                await this.app.vault.adapter.remove(legacy);
                console.debug("vault-curate: removed legacy index.json");
            }
        } catch (err) {
            console.warn("vault-curate: failed to remove legacy index.json", err);
        }
    }

    // ── 015 D4: mobile query-intent loading ─────────────

    /** Current gate state for UI rendering ('ready' covers desktop-with-store). */
    mobileGateState(): MobileGateState {
        if (!Platform.isMobile) return this.store ? "ready" : "failed";
        return this.mobileGate?.state ?? "idle";
    }

    /** Localized status line for the gate's non-ready states. */
    mobileGateStatusText(): string {
        switch (this.mobileGateState()) {
            case "loading": return t.noticeMobileIndexLoading;
            case "failed": return t.mobileIndexLoadFailed;
            case "too-large": return t.mobileIndexTooLarge(this.mobileGate?.lastTooLargeMb ?? 0);
            default: return t.noticeMobileIndexLoading; // idle: a trigger is imminent
        }
    }

    /** Single entry for "make sure the index is available". Desktop resolves
     *  from onload's eager open; mobile lazily loads through the gate
     *  (success cached, failure retryable — see MobileIndexGate). */
    async ensureStoreLoaded(): Promise<SQLiteStore> {
        if (!Platform.isMobile) {
            if (this.store) return this.store;
            throw new Error("vault-curate: backend not ready");
        }
        if (!this.mobileGate) {
            this.mobileGate = new MobileIndexGate<SQLiteStore>({
                statSize: async () => {
                    try {
                        const st = await this.app.vault.adapter.stat(this.dbPath());
                        return st?.size ?? null;
                    } catch {
                        return null; // stat 不可信：未知大小照走 open 的 try/catch
                    }
                },
                openStore: async () => {
                    if (!this.sqlWasmBinary) {
                        this.sqlWasmBinary = await loadWasmAsset(
                            this, "sql-wasm.wasm", SQL_WASM_URL,
                            { persistCache: false }, // mobile never writes the plugin folder
                        );
                    }
                    return this.openStore();
                },
                onSlowLoad: () => new Notice(t.noticeMobileIndexLoading),
            });
        }
        const store = await this.mobileGate.ensureLoaded();
        if (this.store !== store) {
            this.store = store;
            this.scheduleBM25Warm(0); // warm strictly after the store is ready
        }
        return store;
    }

    /** 015 review C1: mobile-safe provider swap — endpoint settings changed,
     *  re-run the D3 decision table. Never touches the index or indexer
     *  (desktop's reloadBackends+rebuildIndex flow is wrong on mobile). */
    refreshMobileProvider(): void {
        if (!Platform.isMobile) return;
        const old = this.provider;
        try {
            this.provider = this.buildMobileProvider();
        } catch (err) {
            console.warn("vault-curate: mobile provider refresh failed — keyword-only search", err);
            this.provider = null;
        }
        old?.dispose();
    }

    /** 015: manual refresh channel — desktop rebuilt the index, the user
     *  taps "Reload index" on mobile: drop the snapshot, re-read the file. */
    async reloadMobileIndex(): Promise<SQLiteStore> {
        if (!Platform.isMobile) return this.ensureStoreLoaded();
        this.store = null;
        await this.mobileGate?.invalidate();
        return this.ensureStoreLoaded();
    }

    /** 015 red-team C3: run a query with deep-read convergence — a store-level
     *  throw (torn iCloud file that passed open()) resets the gate so the next
     *  attempt re-reads the file. Desktop calls fn directly (errors keep their
     *  existing loud paths). Returns null when the query could not run. */
    async runMobileQuery<T>(fn: (store: SQLiteStore) => T | Promise<T>): Promise<T | null> {
        if (!Platform.isMobile) {
            if (!this.store) return null;
            return await fn(this.store);
        }
        let store: SQLiteStore;
        try {
            store = await this.ensureStoreLoaded();
        } catch {
            // Review residual: a load superseded by a concurrent reload
            // rejects even though the fresh store lands right after — one
            // immediate retry turns that race from a silent no-op into a hit.
            try {
                store = await this.ensureStoreLoaded();
            } catch {
                return null; // genuinely failed; gate state renders in the view
            }
        }
        try {
            return await fn(store);
        } catch (e) {
            await this.handleMobileQueryError(e, store);
            return null;
        }
    }

    /** 015 review W2: convergence with a guilt check — only tear down the
     *  index when the store itself is sick (a cheap meta read throws). An
     *  unrelated failure (e.g. a canvas write) must not discard a healthy
     *  70MB snapshot. Also used by the SearchView's own catch (review W3). */
    async handleMobileQueryError(e: unknown, store?: SQLiteStore | null): Promise<void> {
        const probe = store ?? this.store;
        const storeSick = probe ? !probeStoreHealth(probe) : true;
        if (!storeSick) {
            console.error("vault-curate: mobile query failed (index healthy — not resetting)", e);
            new Notice(t.searchFailed);
            return;
        }
        console.error("vault-curate: mobile query failed — resetting index gate", e);
        this.store = null;
        await this.mobileGate?.invalidate();
        new Notice(t.mobileIndexLoadFailed);
    }

    private async openStore(): Promise<SQLiteStore> {
        if (!this.sqlWasmBinary) {
            throw new Error("sql.js WASM bytes not loaded (preload step failed)");
        }
        const adapter: PersistAdapter = {
            read: async (path) => {
                const exists = await this.app.vault.adapter.exists(path);
                if (!exists) return null;
                const buf = await this.app.vault.adapter.readBinary(path);
                return new Uint8Array(buf);
            },
            write: async (path, bytes) => {
                // Copy into a fresh ArrayBuffer so writeBinary's strict
                // ArrayBuffer signature is satisfied without an `as` cast
                // (Uint8Array.buffer is ArrayBufferLike — ArrayBuffer |
                // SharedArrayBuffer — in current TS lib types).
                const ab = new ArrayBuffer(bytes.byteLength);
                new Uint8Array(ab).set(bytes);
                await this.app.vault.adapter.writeBinary(path, ab);
            },
            exists: (path) => this.app.vault.adapter.exists(path),
        };
        // 015: mobile opens read-only — flush no-ops, and the legacy
        // index.json cleanup (an adapter.remove) is desktop housekeeping.
        const store = await SQLiteStore.open(adapter, this.dbPath(), this.sqlWasmBinary, {
            readOnly: Platform.isMobile,
        });
        // 007 D5: inject the desc/body blend weight (store must not read
        // plugin settings itself). Re-injected on every saveSettings().
        store.setComposeAlpha(this.settings.descWeight);
        if (!Platform.isMobile) {
            await this.dropLegacyIndexJson();
        }
        return store;
    }

    /**
     * Build the embedding provider from current settings.
     *
     * Provider selection (Phase 4 wires the WASM default; Phase 8 Settings UI
     * will expose a first-class picker):
     *   - "wasm"              → built-in transformers.js (default, zero-config)
     *   - "ollama"            → external Ollama
     *   - "openai-compatible" → external OpenAI-compatible endpoint
     */
    private makeHttpFetch(): HttpFetch {
        return async (req) => {
            const resp = await requestUrl({
                url: req.url,
                method: req.method,
                headers: req.headers,
                body: req.body,
                throw: false,
            });
            let parsedJson: unknown = null;
            try { parsedJson = resp.json; } catch { /* may not be JSON */ }
            return { status: resp.status, text: resp.text, json: parsedJson };
        };
    }

    /** Shared remote-provider config (ollama / openai-compatible). The mobile
     *  provider path (015 D3) reuses this verbatim so the two never drift. */
    private remoteEmbeddingCfg(): EmbeddingSettings {
        return this.settings.embeddingProvider === "openai-compatible"
            ? {
                providerType: "openai-compatible",
                openaiUrl: this.settings.ollamaUrl,
                openaiModel: this.settings.ollamaModel,
                apiKey: this.settings.apiKey || undefined,
            }
            : {
                providerType: "ollama",
                ollamaUrl: this.settings.ollamaUrl,
                ollamaModel: this.settings.ollamaModel,
                apiKey: this.settings.apiKey || undefined,
            };
    }

    /** 015 D3 decision table: mobile provider — layer 0 (null) unless a
     *  non-loopback remote endpoint is configured (layer 2). Never builds
     *  the WASM provider (no ORT on mobile). Pure settings read, no I/O. */
    private buildMobileProvider(): EmbeddingProvider | null {
        if (this.settings.embeddingProvider === "wasm") return null;
        if (isLoopbackHost(this.settings.ollamaUrl)) return null;
        return createProvider(this.remoteEmbeddingCfg(), { httpFetch: this.makeHttpFetch() });
    }

    private async buildProvider(): Promise<EmbeddingProvider> {
        const httpFetch = this.makeHttpFetch();
        const providerType = this.settings.embeddingProvider;
        if (providerType === "wasm") {
            if (!this.ortWasmBinary) {
                throw new Error("ORT WASM bytes not loaded (preload step failed)");
            }
            return createProvider(
                {
                    providerType: "wasm",
                    // Phase 4 dogfood: bge-base-zh (110M params) takes ~6s/chunk
                    // in Obsidian's Electron worker (wasm only, no native ORT).
                    // Switched to bge-small-zh-v1.5 (33M params) to land in the
                    // same speed class as competitor MiniLM-L12 while keeping
                    // Chinese embedding quality far above the multilingual MiniLM.
                    wasmModelId: "Xenova/bge-small-zh-v1.5",
                    wasmDtype: "q8",
                },
                { workerSource, ortWasmBinary: this.ortWasmBinary },
            );
        }

        return createProvider(this.remoteEmbeddingCfg(), { httpFetch });
    }

    /** Tear down old provider/store, build new from current settings. Used after Settings save. */
    async reloadBackends(): Promise<void> {
        const oldProvider = this.provider;
        let newProvider: EmbeddingProvider | null = null;
        try {
            newProvider = await this.buildProvider();
            this.provider = newProvider;
            // `this.indexer` is undefined when the original backend init failed
            // (try/catch in onload). Skip the setBackends call so reloadBackends
            // doesn't throw before the user has a chance to fix the underlying
            // issue and reload the plugin.
            if (this.store && this.indexer) {
                this.indexer.setBackends(this.store, newProvider);
            }
        } catch (err) {
            // Roll back a partial swap (buildProvider OK but setBackends threw):
            // restore oldProvider as live, dispose the orphan newProvider.
            if (newProvider && this.provider === newProvider) {
                this.provider = oldProvider;
                newProvider.dispose();
            }
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`vault-curate: provider switch failed — ${msg}`, 10000);
            throw err;
        }
        // Swap succeeded; safe to dispose old.
        oldProvider?.dispose();
    }
    // ── Purple-edge promotion (010) ────

    /** Effective Related-section heading: user setting, else locale default.
     *  Sanitized to one line (red-team F2: a tampered data.json can carry a
     *  non-string — `.trim()` on a number throws outside every try — or an
     *  embedded newline, which can never match a single line and turns every
     *  promotion into an EOF multi-line injection). */
    private relatedHeading(): string {
        const custom = String(this.settings.relatedSectionTitle ?? "")
            .split("\n")[0].trim();
        return custom !== "" ? custom : t.relatedSectionDefault;
    }

    /** Scan `canvasFile` for promotable purple edges and open the checkbox
     *  modal (010 D1/D2). Read-only until the user applies. */
    async promotePurpleEdges(canvasFile: TFile) {
        let pairs: PurplePair[];
        try {
            const canvas = JSON.parse(await this.app.vault.read(canvasFile)) as CanvasJson;
            // A brand-new canvas is literally "{}"; hand-edited ones can
            // carry non-array nodes/edges — normalize or bail inside the
            // try so every malformed shape lands on the same Notice.
            canvas.nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
            canvas.edges = Array.isArray(canvas.edges) ? canvas.edges : [];
            pairs = collectPurpleEdges(
                canvas,
                this.app.metadataCache.resolvedLinks,
                (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile,
            );
        } catch (e) {
            console.error("vault-curate: promote scan failed", e);
            new Notice(t.noticePromoteInvalidCanvas);
            return;
        }
        if (pairs.length === 0) {
            new Notice(t.noticePromoteEmpty);
            return;
        }
        new PromoteModal(this.app, pairs, (chosen) => {
            void this.applyPromotions(canvasFile, chosen);
        }, (dismissed) => {
            // 013 D5: the modal is the relation graph's only dismiss entry
            // (canvas edges expose no interaction API).
            this.settings.dismissedPairs[pairKey(dismissed.from, dismissed.to)] = Date.now();
            void this.saveSettings();
        }).open();
    }

    /** Write the accepted pairs as real wikilinks, then recolor their
     *  canvas edges. Order is md first, canvas second (010 D4): if the
     *  canvas write fails, the links exist and the next scan's
     *  resolvedLinks re-verification filters the pair out — the failure
     *  self-heals. The reverse order would leave a gray edge with no link
     *  behind it. These writes are the user's judgment action, so they are
     *  deliberately NOT recorded in the self-write ledger; the new links
     *  make both notes hot regardless of mtime. */
    private async applyPromotions(canvasFile: TFile, chosen: PurplePair[]) {
        const heading = this.relatedHeading();
        const bidirectional = this.settings.promoteBidirectional;

        // Large batches are sequential file writes with the modal already
        // closed — silent background work invites the user to start
        // conflicting actions (visible-background-work discipline).
        if (chosen.length > 10) new Notice(t.noticePromoteWriting(chosen.length));

        let linksWritten = 0;
        let failedWrites = 0;
        const okPairs: PurplePair[] = [];

        for (const pair of chosen) {
            const fromFile = this.app.vault.getAbstractFileByPath(pair.from);
            const toFile = this.app.vault.getAbstractFileByPath(pair.to);
            if (!(fromFile instanceof TFile) || !(toFile instanceof TFile)) {
                failedWrites++;
                continue;
            }
            try {
                const link = this.app.fileManager.generateMarkdownLink(toFile, pair.from);
                let inserted = false;
                await this.app.vault.process(fromFile, (data) => {
                    const next = insertRelatedLink(data, heading, link);
                    inserted = next !== null;
                    return next ?? data;
                });
                if (inserted) linksWritten++;
            } catch (e) {
                // Source write failed: nothing on disk for this pair —
                // leave its edges purple (D8).
                console.error(`vault-curate: promote write failed for ${pair.from}`, e);
                failedWrites++;
                continue;
            }
            if (bidirectional) {
                try {
                    const back = this.app.fileManager.generateMarkdownLink(fromFile, pair.to);
                    let inserted = false;
                    await this.app.vault.process(toFile, (data) => {
                        const next = insertRelatedLink(data, heading, back);
                        inserted = next !== null;
                        return next ?? data;
                    });
                    if (inserted) linksWritten++;
                } catch (e) {
                    // Second-file failure: the forward link exists, so the
                    // pair still counts and its edges still turn gray (D8).
                    console.error(`vault-curate: promote reverse write failed for ${pair.to}`, e);
                    failedWrites++;
                }
            }
            okPairs.push(pair);
        }

        let changedEdges = 0;
        let matchedCount = 0;
        let canvasUpdated = false;
        if (okPairs.length > 0) {
            try {
                await this.app.vault.process(canvasFile, (data) => {
                    const parsed = JSON.parse(data) as CanvasJson;
                    parsed.nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
                    parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
                    const result = promoteEdgesInCanvas(parsed, okPairs, bidirectional);
                    changedEdges = result.changedEdges;
                    matchedCount = result.matchedPairs.size;
                    if (result.changedEdges === 0) return data;
                    return JSON.stringify(result.canvas, null, "\t");
                });
                canvasUpdated = true;
            } catch (e) {
                console.error("vault-curate: promote canvas update failed", e);
                new Notice(t.noticePromoteCanvasFailed);
            }
        }

        new Notice(t.noticePromoteDone(linksWritten, changedEdges));
        // Only meaningful when the canvas write itself succeeded — after a
        // failed write, matchedCount is garbage and the "changed meanwhile"
        // wording would contradict the canvas-failed Notice above.
        const skippedPairs = canvasUpdated ? okPairs.length - matchedCount : 0;
        if (skippedPairs > 0) new Notice(t.noticePromoteSkipped(skippedPairs));
        if (failedWrites > 0) new Notice(t.noticePromotePartial(failedWrites));
    }

    // ── Heat: tier derivation + self-write ledger (010) ────

    /** One resolver per query, frozen for its duration (010 D5). */
    tierResolver(): TierResolver {
        return makeTierResolver(this.app, this.selfWrites, this.settings.hotDays);
    }

    /** 011 D2: keyword ranks for relatedness fusion, built from the anchor
     *  note's frontmatter tags (title fallback). Injected ONLY into the
     *  anchored surfaces (Find Similar / relation graph / expand / Discover
     *  current note) — global Discover and the semantic-path k-NN graph
     *  have no anchor pseudo-query subject and stay pure cosine (D4). */
    relatedKwRankFor(file: TFile): Map<string, number> {
        if (!this.store) return new Map();
        if (!this.store.isBM25Warm()) {
            // Degrade this query to pure cosine, but close the gap soon —
            // fusion quality must not depend on whether the user happened
            // to search since the last save.
            this.scheduleBM25Warm();
            return new Map();
        }
        const fm: Record<string, unknown> | undefined =
            this.app.metadataCache.getFileCache(file)?.frontmatter;
        // Obsidian accepts both `tags:` and the singular `tag:` key.
        return relatedKwRank(this.store, file.path, file.basename, fm?.tags ?? fm?.tag);
    }

    /** 012 D1/D2: the Global Discover thinking profile — recent
     *  judgment-action notes (plugin self-writes exempted), their topical
     *  tags (structural tags df-filtered) and vector centroid, plus the
     *  profile's keyword ranks. Rebuilt per query; O(N) over the in-memory
     *  metadataCache. */
    globalProfileFor(): { centroid: Float32Array | null; kwRank: Map<string, number> } {
        const store = this.store;
        if (!store) return { centroid: null, kwRank: new Map() };
        const t0 = Date.now();

        const files = this.app.vault.getMarkdownFiles();
        const dfMap = new Map<string, number>();
        const candidates: ProfileCandidate[] = [];
        for (const f of files) {
            const fm: Record<string, unknown> | undefined =
                this.app.metadataCache.getFileCache(f)?.frontmatter;
            const tags = parseTags(fm?.tags ?? fm?.tag);
            for (const tag of new Set(tags)) {
                dfMap.set(tag, (dfMap.get(tag) ?? 0) + 1);
            }
            const selfWrite = this.selfWrites[f.path];
            candidates.push({
                path: f.path,
                // Clamped to now: a future-dated frontmatter `created`
                // (template leftovers) would otherwise freeze the profile
                // on zombie notes forever (red-team F6).
                judgedAt: Math.min(Math.max(resolveCreated(this.app, f), f.stat.mtime), Date.now()),
                tags,
                exempt: selfWrite !== undefined
                    && Math.abs(f.stat.mtime - selfWrite) <= SELF_WRITE_TOLERANCE_MS,
            });
        }

        const profile = buildProfile(candidates, dfMap, files.length);
        const vecs: Float32Array[] = [];
        for (const p of profile.paths) {
            const v = store.getNoteVec(p);
            if (v) vecs.push(v);
        }
        const centroid = profileCentroid(vecs);
        const kwRank = profile.tags.length > 0
            ? kwRankForQuery(store, profile.tags.join(" "))
            : new Map<string, number>();
        console.debug(
            `vault-curate: global profile built in ${Date.now() - t0}ms `
            + `(${profile.paths.length} notes, ${profile.tags.length} tags, ${kwRank.size} kw hits)`,
        );
        return { centroid, kwRank };
    }

    /** Debounced background BM25 warm-up (011 perf follow-up). */
    scheduleBM25Warm(delayMs = 5000): void {
        if (!this.store) return;
        if (this.bm25WarmTimer !== null) window.clearTimeout(this.bm25WarmTimer);
        this.bm25WarmTimer = window.setTimeout(() => {
            this.bm25WarmTimer = null;
            void this.store?.warmBM25IndexAsync()
                .then(() => {
                    // A mutation mid-build discards that build; a caller
                    // coalesced onto the doomed task must not lose its
                    // retry (red-team F2). Re-check and reschedule —
                    // debounce pacing keeps edit storms from spinning.
                    if (this.store && !this.store.isBM25Warm()) {
                        this.scheduleBM25Warm(delayMs);
                    }
                })
                .catch(() => { /* disposed mid-build (F1) — plugin unloading */ });
        }, delayMs);
    }

    /** Record a plugin-initiated write so it doesn't count as a user
     *  judgment action (010 D6). Prunes + persists on every call — batch
     *  callers are LLM-bound, so one saveData per file is noise. */
    recordSelfWrite(path: string, mtime: number): void {
        this.selfWrites[path] = mtime;
        this.pruneSelfWrites();
        void this.saveSettings();
    }

    /** Drop entries that fell outside the hotDays window — past it, the
     *  mtime can't make the note hot anyway, so the ledger self-limits. */
    private pruneSelfWrites(): void {
        const cutoff = Date.now() - this.settings.hotDays * 24 * 60 * 60 * 1000;
        for (const [path, mtime] of Object.entries(this.selfWrites)) {
            if (mtime < cutoff) delete this.selfWrites[path];
        }
    }

    async loadSettings() {
        const raw: unknown = await this.loadData();
        // data.json should always parse to an object. If a user (or a tool
        // crash) left it in a non-object shape, back the broken file up so
        // they can inspect it instead of silently overwriting on the next
        // saveData, then fall back to defaults.
        if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
            console.warn("vault-curate: data.json is not an object — using defaults. Got:", typeof raw);
            await this.backupCorruptDataJson(raw);
        }
        const data = (raw && typeof raw === "object" && !Array.isArray(raw))
            ? raw as Partial<VaultSearchData>
            : null;
        this.settings = mergeSettings(data?.settings, DEFAULT_SETTINGS);

        // 010 D6: self-write ledger rides the same data.json (own top-level
        // key, no Settings UI). Same tamper surface as the hidden settings:
        // keep only finite-number entries.
        const sw = data?.selfWrites;
        this.selfWrites = (sw && typeof sw === "object" && !Array.isArray(sw))
            ? Object.fromEntries(Object.entries(sw)
                .filter(([, v]) => typeof v === "number" && Number.isFinite(v)))
            : {};

        // Phase 4 (004 rebrand) chunk tuning migration: v0.3 default 1000/200
        // is too small for bge-small-zh WASM throughput in Obsidian's Electron
        // worker. Force-upgrade users still on the old default.
        if (this.settings.chunkSize === 1000 && this.settings.chunkOverlap === 200) {
            this.settings.chunkSize = 2000;
            this.settings.chunkOverlap = 100;
        }

        // Defend against data.json tampering / partial load: clamp topResults
        // like the UI onChange handler does. NaN / null / non-positive falls
        // back to default; values above 100 are capped to prevent OOM during
        // searchHybrid's full-chunk cosine sweep.
        const tr = Number(this.settings.topResults);
        this.settings.topResults = Number.isFinite(tr) && tr > 0
            ? Math.min(Math.trunc(tr), 100)
            : DEFAULT_SETTINGS.topResults;

        // 007 D5 hidden settings share the same tamper surface (data.json is
        // their ONLY edit path). A non-numeric descWeight would ride
        // Math.min/Math.max as NaN into every composed note vector — and NaN
        // scores pass every `score < minScore` filter silently (red-team
        // finding, 1.2.0 pre-release review). Same guard for minDescChars:
        // NaN makes the backfill's `length(description) >= ?` never match,
        // silently disabling the upgrade path.
        // 010 red-team F1: hotDays shares the tamper surface. NaN poisons
        // deriveTier (`now - t < NaN` is always false → whole vault goes
        // Cold silently) AND pruneSelfWrites (`mtime < NaN` never true →
        // ledger never shrinks). Same guard shape as the fields below.
        const hd = Number(this.settings.hotDays);
        this.settings.hotDays = Number.isFinite(hd) && hd > 0
            ? Math.trunc(hd)
            : DEFAULT_SETTINGS.hotDays;

        const dw = Number(this.settings.descWeight);
        this.settings.descWeight = Number.isFinite(dw)
            ? Math.max(0, Math.min(dw, 1))
            : DEFAULT_SETTINGS.descWeight;
        const mdc = Number(this.settings.minDescChars);
        this.settings.minDescChars = Number.isFinite(mdc) && mdc >= 0
            ? Math.trunc(mdc)
            : DEFAULT_SETTINGS.minDescChars;
        const sfc = Number(this.settings.sameFolderCap);
        this.settings.sameFolderCap = Number.isFinite(sfc) && sfc >= 0
            ? Math.trunc(sfc)
            : DEFAULT_SETTINGS.sameFolderCap;

        // Phase 8 (004 rebrand): strip legacy v0.3.x fields that were carried
        // along by the loose Object.assign spread. Avoids stale `chunkingMode`,
        // `minDescLength`, and embedded `index` chunks polluting data.json.
        const settingsAny = this.settings as unknown as Record<string, unknown>;
        delete settingsAny.chunkingMode;
        delete settingsAny.minDescLength;
        delete settingsAny.index;

        this.pruneSelfWrites();
        const migrated: VaultSearchData = { settings: this.settings, selfWrites: this.selfWrites };
        await this.saveData(migrated);
    }

    async saveSettings() {
        // 013 D10: serialize saves — the snapshot is taken when the queued
        // job RUNS, not when saveSettings is called, so a queued save always
        // writes the freshest state and an older overlapping call can never
        // clobber a newer one on slow disk I/O.
        await this.saveQueue(async () => {
            const data: VaultSearchData = { settings: this.settings, selfWrites: this.selfWrites };
            await this.saveData(data);
            // 007 D5: keep the store's blend weight in sync with settings.
            this.store?.setComposeAlpha(this.settings.descWeight);
        });
    }

    /** Snapshot a malformed data.json before defaults overwrite it. Best-effort. */
    private async backupCorruptDataJson(raw: unknown): Promise<void> {
        try {
            const dir = this.manifest.dir;
            if (!dir) return;
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            // 6-char random suffix so two corrupt loads in the same ms (or
            // a manifest.dir-undefined retry loop) don't overwrite each
            // other's evidence. Math.random is enough — this is forensics,
            // not crypto.
            const rand = Math.random().toString(36).slice(2, 8);
            const path = normalizePath(`${dir}/data.corrupt-${stamp}-${rand}.json`);
            const payload = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
            await this.app.vault.adapter.write(path, payload);
            console.warn(`vault-curate: backed up corrupt data.json to ${path}`);
        } catch (err) {
            console.warn("vault-curate: failed to back up corrupt data.json", err);
        }
    }
}
