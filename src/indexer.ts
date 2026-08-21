/**
 * Indexer — SQLite-backed vault indexer for vault-curate (Phase 4 of 004 rebrand).
 *
 * Design rationale: see openspec/changes/004-vault-curate-rebrand/design.md D2 + D3 + D4.
 *
 * Pipeline per .md file:
 *   1. read content + frontmatter (description / tags / tier inputs)
 *   2. body = stripFrontmatter; chunks = splitChunks(body, title, settings)
 *   3. chunkVecs = await provider.embed(chunks.map(c => denoiseForEmbed(c.content)))
 *      (007 D1: embed input is denoised; stored chunk content stays raw)
 *   4. bodyVec = meanPool(chunkVecs)
 *   5. store.upsertNote(...) + store.upsertChunks(...)
 *
 * Embedding pool only contains chunk vectors (NOT title or description).
 * Title is stored as plain text for D6 fuzzy search; description for UI preview.
 *
 * Provider switch detection (Phase 3 dogfood gap fix):
 *   On every scanVault entry, compare meta.embedding_model_id with provider.modelId.
 *   Mismatch → clearAllData() + full re-index. Prevents silent search corruption
 *   when user changes embedding model without mtime change on existing notes.
 */
import { Notice, TFile } from "obsidian";
import type VaultSearchPlugin from "./main";
import { SQLiteStore } from "./storage/SQLiteStore";
import type { EmbeddingProvider } from "./embedding";
import { splitChunks } from "./indexer/chunker";
import { denoiseForEmbed, hasDenoisableContent, DENOISE_VERSION } from "./indexer/denoise";
import { t2sForEmbed, hasCJK, T2S_VERSION } from "./indexer/preproc";
import { findH1Collisions, type FileTitleSource } from "./indexer/titleCollisions";
import { findStalePaths, findChangedPaths, isImplausibleWipe } from "./indexer/staleReconcile";
import { deriveTier } from "./heat/deriveTier";
import { resolveCreated } from "./heat/makeTierResolver";
import { meanPool } from "./utils/meanPool";
import { stripFrontmatter } from "./utils";
import { TOKENIZER_VERSION } from "./storage/cjkTokenize";
import { t } from "./i18n";

const EMBED_BATCH_SIZE = 8;
const PROGRESS_STEP = 1;
// runSemantic does a full-table cosine sweep. Past this chunk count the
// per-query latency creeps above a few seconds on average hardware, so we
// warn the user once at rebuild time rather than per-search.
const LARGE_VAULT_CHUNK_THRESHOLD = 15000;
// 021: how many notes the startup catch-up will re-index before it stops and
// hands the job to a deliberate "Update index". Sized so the startup path can
// never cost more than a few seconds of embedding: a week of synced edits is
// the user's decision to pay for, not a surprise at launch.
const CATCHUP_MAX = 20;

export class Indexer {
    indexing = false;
    private emptySkippedCount = 0;

    /** 014 D8: single-file mutation hook for the k-NN graph maintainer.
     *  Fired by indexSingleFile ('upsert') and removeNote ('remove') —
     *  rename decomposes into both. Bulk passes (scanVault/rebuild) go
     *  through indexOne directly and deliberately do NOT fire this; the
     *  manager's revision backstop covers them. */
    onMutation?: (type: 'upsert' | 'remove', path: string) => void;

    constructor(
        private plugin: VaultSearchPlugin,
        private store: SQLiteStore,
        private provider: EmbeddingProvider,
    ) {}

    /** Replace the active SQLiteStore/provider (used by Settings provider-switch flow). */
    setBackends(store: SQLiteStore, provider: EmbeddingProvider): void {
        this.store = store;
        this.provider = provider;
    }

    shouldExclude(path: string): boolean {
        const configDir = this.plugin.app.vault.configDir;
        if (path.startsWith(configDir + "/") || path === configDir) return true;
        return this.plugin.settings.excludePatterns.some(p => path.includes(p));
    }

    private getMarkdownFiles(): TFile[] {
        return this.plugin.app.vault
            .getMarkdownFiles()
            .filter(f => !this.shouldExclude(f.path));
    }

    /**
     * Adapter: pull H1 + frontmatter-title presence from Obsidian's
     * metadataCache and delegate to the pure findH1Collisions helper.
     * The returned set contains H1 values shared across 2+ files where no
     * frontmatter title overrides them — extractTitle() falls back to
     * file.basename for those H1s.
     */
    private buildH1Collisions(files: TFile[]): Set<string> {
        const items: FileTitleSource[] = files.map(file => {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const hasFrontmatterTitle = cache?.frontmatter?.title != null;
            const h1Raw = cache?.headings?.find(h => h.level === 1)?.heading;
            const trimmed = h1Raw ? String(h1Raw).trim() : "";
            return { hasFrontmatterTitle, h1: trimmed || null };
        });
        return findH1Collisions(items);
    }

    private extractTitle(file: TFile, h1Collisions?: Set<string>): string {
        const cache = this.plugin.app.metadataCache.getFileCache(file);

        // Priority chain: frontmatter title > unique H1 > file.basename.
        // H1 only wins when it's unique across the vault — duplicated H1s
        // (typical of template-generated notes) fall through to basename.
        let raw: string;
        const fm: Record<string, unknown> | undefined = cache?.frontmatter;
        const fmTitle = fm?.title;
        if (fmTitle != null) {
            raw = String(fmTitle);
        } else {
            const h1 = cache?.headings?.find(h => h.level === 1)?.heading;
            const h1Trimmed = h1 ? String(h1).trim() : "";
            if (h1Trimmed && !h1Collisions?.has(h1Trimmed)) {
                raw = h1Trimmed;
            } else {
                raw = file.basename;
            }
        }

        // Strip wikilink syntax: [[path/name]] → name, [[name|alias]] → alias
        if (raw.startsWith("[[") && raw.endsWith("]]")) {
            let title = raw.slice(2, -2);
            const pipeIdx = title.indexOf("|");
            if (pipeIdx >= 0) {
                title = title.slice(pipeIdx + 1);
            } else {
                const slashIdx = title.lastIndexOf("/");
                if (slashIdx >= 0) title = title.slice(slashIdx + 1);
            }
            return title;
        }
        return raw;
    }

    private extractDescription(file: TFile): string | null {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm: Record<string, unknown> | undefined = cache?.frontmatter;
        const desc = fm?.description;
        return typeof desc === "string" && desc.length > 0 ? desc : null;
    }

    /** Build a Set of file paths that have at least one incoming link (O(N) once). */
    private buildIncomingSet(): Set<string> {
        const set = new Set<string>();
        const resolvedLinks = this.plugin.app.metadataCache.resolvedLinks;
        for (const [src, targets] of Object.entries(resolvedLinks)) {
            for (const path of Object.keys(targets)) {
                if (path !== src) set.add(path);
            }
        }
        return set;
    }

    /** Index-time tier is ADVISORY since 010 (queries derive fresh via
     *  makeTierResolver); routed through the same deriveTier so the stored
     *  value can never disagree with the derived one at write time. */
    private computeTier(file: TFile, incomingSet: Set<string>): "hot" | "cold" {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const hasOutgoing = (cache?.links?.length ?? 0) > 0 || (cache?.embeds?.length ?? 0) > 0;

        return deriveTier({
            created: resolveCreated(this.plugin.app, file),
            mtime: file.stat.mtime,
            hasOutgoing,
            hasIncoming: incomingSet.has(file.path),
            selfWriteMtime: this.plugin.selfWrites[file.path],
            now: Date.now(),
            hotDays: this.plugin.settings.hotDays,
        });
    }

    /**
     * Full vault re-index. Wipes existing chunks/notes, re-embeds everything.
     * Always called after provider switch or on user demand.
     */
    async rebuild(): Promise<void> {
        if (this.store.isDisposed) return;
        await this.ensureProviderReady();
        if (this.store.isDisposed) return;
        this.store.clearAllData();
        this.emptySkippedCount = 0;

        const files = this.getMarkdownFiles();
        if (files.length === 0) {
            new Notice(t.noticeIndexDone(0, 0, 0, 0), 5000);
            return;
        }

        const incomingSet = this.buildIncomingSet();
        const h1Collisions = this.buildH1Collisions(files);
        const progress = new Notice(t.noticeIndexing(0, files.length), 0);

        let done = 0;
        let failed = 0;
        let hot = 0;
        let cold = 0;
        for (const file of files) {
            const ok = await this.indexOne(file, incomingSet, h1Collisions);
            if (!ok) failed++;
            else {
                const tier = this.computeTier(file, incomingSet);
                if (tier === "hot") hot++;
                else cold++;
            }
            done++;
            if (done % PROGRESS_STEP === 0 || done === files.length) {
                progress.setMessage(t.noticeIndexing(done, files.length));
                await new Promise(r => window.setTimeout(r, 0));
            }
        }

        progress.hide();
        this.writeIndexMeta();
        // Full rebuild embeds everything through denoiseForEmbed, so the
        // one-time upgrade scan is moot — stamp it done. MUST stay outside
        // writeIndexMeta() (indexSingleFile calls that on every file edit).
        this.store.setMeta("denoise_version", DENOISE_VERSION);
        this.store.setMeta("t2s_version", T2S_VERSION);
        // 019 G1 review C1: a full rebuild holds `indexing` for as long as it
        // takes to re-embed the vault (minutes), and onFileChange drops every
        // delete event for that whole window. clearAllData() only rules out
        // rows for notes deleted BEFORE their turn (indexOne's read fails and
        // writes nothing) — a note indexed at pass i and deleted at pass j>i
        // keeps its row. Same pass as update()'s exits, on the longest window
        // of the three.
        this.pruneStale("post-rebuild", (p) => this.isLiveForUpdate(p));
        await this.store.flush();
        // 007 D9: pay the inverted-index build here (index was invalidated by
        // the upserts above) so the user's next search is <1ms, not ~3s.
        // Wrapped in a Notice — a silent multi-second freeze right after the
        // progress notice hides reads as a hang (compliance review W1).
        const warmNotice1 = new Notice(t.noticeBuildingSearchIndex, 0);
        try { this.store.warmBM25Index(); } finally { warmNotice1.hide(); }

        new Notice(t.noticeIndexDone(done - failed, hot, cold, failed), 10000);
        if (this.emptySkippedCount > 0) {
            new Notice(t.noticeEmptySkipped(this.emptySkippedCount), 6000);
        }
        const chunkCount = this.store.countChunks();
        if (chunkCount > LARGE_VAULT_CHUNK_THRESHOLD) {
            new Notice(t.noticeLargeVault(chunkCount), 10000);
        }
        console.debug(`vault-curate: rebuild complete — ${done - failed} notes (${failed} failed, ${this.emptySkippedCount} empty, ${chunkCount} chunks)`);
    }

    /**
     * Incremental update.
     *   - If provider.modelId differs from stored meta, falls through to rebuild().
     *   - Otherwise: re-index notes with mtime > stored mtime, delete vanished notes.
     */
    async update(): Promise<void> {
        if (this.store.isDisposed) return;
        await this.ensureProviderReady();
        if (this.store.isDisposed) return;
        this.emptySkippedCount = 0;

        // Trigger rebuild when:
        //   - has an existing index (last_indexed_at present), AND
        //   - tokenizer version doesn't match (null = pre-r2 index that never
        //     wrote the key; mismatch = real upgrade)
        // Skip for fresh installs (no last_indexed_at) so the first scan isn't
        // wasted on "rebuild" against an empty store.
        const storedTokenizer = this.store.getMeta("cjk_tokenizer_version");
        const hasIndex = !!this.store.getMeta("last_indexed_at");
        if (hasIndex && storedTokenizer !== TOKENIZER_VERSION) {
            new Notice(
                `vault-curate: tokenizer upgraded (${storedTokenizer ?? "v1"} → ${TOKENIZER_VERSION}). Rebuilding index...`,
                8000,
            );
            await this.rebuild();
            return;
        }

        const storedModel = this.store.getMeta("embedding_model_id");
        if (storedModel && storedModel !== this.provider.modelId) {
            new Notice(
                `vault-curate: embedding model changed (${storedModel} → ${this.provider.modelId}). Rebuilding index...`,
                8000,
            );
            await this.rebuild();
            return;
        }

        // One-time denoise upgrade scan (007 D2): when the rule set version
        // changed (or was never stamped — pre-1.2.0 index), notes whose body
        // contains denoisable symbols need a re-embed. Detection uses
        // hasDenoisableContent (pure regex test), NEVER denoiseForEmbed(x)!==x —
        // whitespace folding would flag nearly every note and degenerate this
        // into a full rebuild. Measured re-embed surface: 16% of the dogfood
        // vault (design D3).
        const denoiseUpgrade = hasIndex && this.store.getMeta("denoise_version") !== DENOISE_VERSION;
        // 008 D4: t2s rule-table version. Trigger surface is near-total
        // (every CJK-bearing note), i.e. effectively a full re-embed — the
        // standard indexing progress notice keeps it visible.
        const t2sUpgrade = hasIndex && this.store.getMeta("t2s_version") !== T2S_VERSION;

        const files = this.getMarkdownFiles();
        const incomingSet = this.buildIncomingSet();
        const h1Collisions = this.buildH1Collisions(files);

        // Drop rows for notes that vanished (renamed / deleted) or fell out
        // of scope via the exclusion settings. 019: was an inline body_vec
        // scan against the file list; now the shared pass (D1/D2/D3), with
        // update()'s stricter predicate keeping the exclusion behaviour.
        this.pruneStale("pre-update", (p) => this.isLiveForUpdate(p));

        // Filter to notes needing re-embed: missing in store OR mtime newer
        // OR title changed (collision rules shifted, or 1.0.4 upgrade where
        // stored titles predate H1 collision detection). Title is prepended
        // into chunk content (see chunker.ts) so a stale title means stale
        // BM25 + embedding — full re-index keeps storage consistent.
        const toReindex: TFile[] = [];
        for (const file of files) {
            const stored = this.store.getNote(file.path);
            if (!stored) {
                toReindex.push(file);
                continue;
            }
            if (stored.mtime !== file.stat.mtime) {
                toReindex.push(file);
                continue;
            }
            const currentTitle = this.extractTitle(file, h1Collisions);
            if (stored.title !== currentTitle) {
                toReindex.push(file);
                continue;
            }
            if (denoiseUpgrade || t2sUpgrade) {
                const content = await this.plugin.app.vault.cachedRead(file);
                const body = stripFrontmatter(content);
                const needDenoise = denoiseUpgrade && hasDenoisableContent(body);
                // Description conversion rides indexOne (design 008 D4:
                // single upgrade path, backfill untouched) — so a CJK desc
                // on an all-English body must also re-index.
                const needT2s = t2sUpgrade && (hasCJK(body) || hasCJK(stored.description ?? ""));
                if (needDenoise || needT2s) {
                    toReindex.push(file);
                }
            }
        }
        if (denoiseUpgrade || t2sUpgrade) {
            console.debug(`vault-curate: upgrade scan → ${toReindex.length} notes to re-embed (denoise v${DENOISE_VERSION}${denoiseUpgrade ? "*" : ""}, t2s v${T2S_VERSION}${t2sUpgrade ? "*" : ""})`);
        }

        if (toReindex.length === 0) {
            // Tiers may still need refresh because resolvedLinks may have changed.
            // Cheap pass: re-compute and upsert with same body_vec.
            for (const file of files) {
                const stored = this.store.getNote(file.path);
                if (!stored) continue;
                const newTier = this.computeTier(file, incomingSet);
                if (newTier !== stored.tier) {
                    this.store.upsertNote({ ...stored, tier: newTier });
                }
            }
            // Scan ran and found nothing to re-embed — stamp so it never re-runs.
            // MUST stay outside writeIndexMeta(): indexSingleFile also calls that,
            // and a single-file edit would falsely mark the one-time scan as done.
            if (denoiseUpgrade) this.store.setMeta("denoise_version", DENOISE_VERSION);
            if (t2sUpgrade) this.store.setMeta("t2s_version", T2S_VERSION);
            await this.backfillDescVecs();
            // 019 D6: a delete event that landed while `indexing` was true
            // got dropped by onFileChange's guard, and the pass at the top
            // of this run had already gone by — re-run it so the window
            // closes inside this same run instead of surviving until the
            // next launch. Cheap: one path SELECT + map lookups. This exit
            // needs it as much as the main one: backfillDescVecs above can
            // run for minutes with `indexing` held.
            this.pruneStale("post-update", (p) => this.isLiveForUpdate(p));
            await this.store.flush();
            new Notice(t.noticeUpToDate);
            return;
        }

        const progress = new Notice(t.noticeIndexing(0, toReindex.length), 0);
        let done = 0;
        let failed = 0;
        for (const file of toReindex) {
            const ok = await this.indexOne(file, incomingSet, h1Collisions);
            if (!ok) failed++;
            done++;
            if (done % PROGRESS_STEP === 0 || done === toReindex.length) {
                progress.setMessage(t.noticeIndexing(done, toReindex.length));
                await new Promise(r => window.setTimeout(r, 0));
            }
        }
        progress.hide();

        // Recompute all tiers (incoming links may have shifted globally).
        for (const file of files) {
            const stored = this.store.getNote(file.path);
            if (!stored) continue;
            const newTier = this.computeTier(file, incomingSet);
            if (newTier !== stored.tier) {
                this.store.upsertNote({ ...stored, tier: newTier });
            }
        }

        this.writeIndexMeta();
        // Unconditional: either the upgrade scan just completed, or everything
        // (re)indexed in this pass already went through denoiseForEmbed (fresh
        // index). MUST stay outside writeIndexMeta(): indexSingleFile also
        // calls that, and a single-file edit would falsely mark the one-time
        // scan as done.
        this.store.setMeta("denoise_version", DENOISE_VERSION);
        this.store.setMeta("t2s_version", T2S_VERSION);
        await this.backfillDescVecs();
        // 019 D6: same as the early-return exit above — catch deletes whose
        // events were dropped while this run held `indexing`.
        this.pruneStale("post-update", (p) => this.isLiveForUpdate(p));
        await this.store.flush();
        // 007 D9: same as rebuild() — rebuild the BM25 index while we're
        // already in an indexing pass. The up-to-date early return above
        // deliberately does NOT warm (would add ~3s to every clean startup).
        const warmNotice2 = new Notice(t.noticeBuildingSearchIndex, 0);
        try { this.store.warmBM25Index(); } finally { warmNotice2.hide(); }

        const total = files.length;
        const hot = files
            .map(f => this.store.getNote(f.path)?.tier)
            .filter(t => t === "hot").length;
        new Notice(t.noticeUpdated(done - failed, total, hot), 10000);
        if (this.emptySkippedCount > 0) {
            new Notice(t.noticeEmptySkipped(this.emptySkippedCount), 6000);
        }
    }

    async indexSingleFile(file: TFile): Promise<void> {
        if (this.store.isDisposed) return;
        await this.ensureProviderReady();
        if (this.store.isDisposed) return;
        const incomingSet = this.buildIncomingSet();
        const h1Collisions = this.buildH1Collisions(this.getMarkdownFiles());
        await this.indexOne(file, incomingSet, h1Collisions);
        this.writeIndexMeta();
        // The upsert just invalidated the BM25 index — re-warm it in the
        // background so relatedness fusion stays consistently available
        // (011 perf follow-up; sliced build, never blocks this path).
        this.plugin.scheduleBM25Warm();
        this.onMutation?.('upsert', file.path);
    }

    /**
     * 019 D1-D4: the startup reconcile (main.ts). Notes deleted while
     * Obsidian wasn't running fire no `delete` event and nothing else prunes
     * them, so a steady-state launch used to leave ghost rows answering
     * searches until the user happened to run Update/Rebuild (issue #13).
     *
     * Existence ONLY — NEVER shouldExclude(), and never the indexer's own
     * exclusion-filtered getMarkdownFiles(): reusing that at startup would
     * silently purge a folder the user merely excluded, and re-including it
     * costs a full re-embed. Acting on the exclusion settings stays where it
     * has always been, inside a user-triggered update() (decision G14). The
     * raw vault.getMarkdownFiles() below is a COUNT for the empty-universe
     * guard — it never decides whether an individual row lives or dies.
     */
    reconcileStale(): number {
        if (this.store.isDisposed) return 0;
        // Refuse to reconcile against an empty universe. A vault reporting
        // zero markdown files is either genuinely empty (nothing worth
        // pruning) or not finished loading — and the second case would wipe
        // the whole index, which costs a full re-embed to recover. This pass
        // has exactly one failure mode that actually hurts the user, and
        // these two guards are what keep it from firing.
        if (this.plugin.app.vault.getMarkdownFiles().length === 0) {
            console.debug("vault-curate: reconcile (startup) — skipped, vault reports no markdown files");
            return 0;
        }
        const paths = this.store.listNotePaths();
        const stale = findStalePaths(paths, (path) => this.fileExists(path));
        // 019 G3 review W2: the empty check above catches a file list that
        // never loaded; this catches one that loaded partially, where the
        // ratio is the only tell. Loud no-op beats silent wipe — the user
        // gets a notice and can run Update index once they know why.
        if (isImplausibleWipe(stale.length, paths.length)) {
            console.warn(
                `vault-curate: reconcile (startup) — REFUSED, ${stale.length} of ${paths.length} indexed notes look missing. ` +
                `That is more likely an incompletely loaded vault than a real deletion; run "Update index" to reconcile deliberately.`,
            );
            new Notice(t.noticeStaleRefused(stale.length, paths.length), 12000);
            return 0;
        }
        return this.removeStale("startup", stale);
    }

    /** Live = the file is there. Deliberately blind to the exclusion
     *  settings — see reconcileStale's contract. */
    private fileExists(path: string): boolean {
        return this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile;
    }

    /**
     * update()'s reconcile predicate: STRICTER than reconcileStale(). A
     * manual "Update index" has always applied the current exclusion
     * settings (pre-019 its reconcile compared against getMarkdownFiles(),
     * which is exclusion-filtered), so that behaviour lives on here — and
     * only here.
     */
    private isLiveForUpdate(path: string): boolean {
        return this.fileExists(path) && !this.shouldExclude(path);
    }

    /**
     * Shared prune core. Deletion goes through removeNote(), NEVER
     * store.deleteNote() directly: deleteNote nulls the warm BM25 index, and
     * removeNote is what schedules the background re-warm — otherwise a
     * batch cleanup hands the user a ~3s synchronous rebuild on their next
     * search (D3). One log line per pass, always: a silent index that
     * quietly shrank is indistinguishable from a broken one, and the named
     * paths are what let the user reconcile it against what they deleted.
     */
    private pruneStale(label: string, isLive: (path: string) => boolean): number {
        if (this.store.isDisposed) return 0;
        return this.removeStale(label, findStalePaths(this.store.listNotePaths(), isLive));
    }

    /** The only place stale rows are actually deleted. MUST stay on
     *  removeNote() — see pruneStale's contract. Locked by a source-level
     *  regression test (staleReconcile.test.ts), because a swap back to
     *  store.deleteNote() is behaviour no behavioural test can see. */
    private removeStale(label: string, stale: string[]): number {
        const detail = stale.length > 0 ? ` — ${stale.join(", ")}` : "";
        console.debug(`vault-curate: reconcile (${label}) — pruned ${stale.length}${detail}`);
        for (const path of stale) {
            this.removeNote(path);
        }
        return stale.length;
    }

    /**
     * 021: re-index notes whose file changed since we last saw it.
     *
     * Two ways an update goes missing: the 2s debounce never fired because
     * Obsidian closed first (onunload only clears the timers), and edits that
     * happened while Obsidian wasn't running at all (sync client, git). Both
     * used to persist until the user happened to run Update index by hand —
     * the note simply stayed unsearchable. 019's startup pass walks the same
     * rows but only deletes; this is the other half.
     *
     * Deliberately simple: it loops indexSingleFile() rather than assembling
     * incomingSet/h1Collisions once. Under CATCHUP_MAX notes that duplication
     * is wasted work, and zero new logic is worth more here than the savings.
     */
    async catchUpChanged(): Promise<{ reindexed: number; deferred: number }> {
        if (this.store.isDisposed || this.indexing) return { reindexed: 0, deferred: 0 };
        const vault = this.plugin.app.vault;
        const changed = findChangedPaths(this.store.listNoteMtimes(), (path) => {
            const file = vault.getAbstractFileByPath(path);
            return file instanceof TFile ? file.stat.mtime : null;
        }).filter((path) => !this.shouldExclude(path));
        if (changed.length === 0) return { reindexed: 0, deferred: 0 };
        if (changed.length > CATCHUP_MAX) {
            console.debug(`vault-curate: catch-up deferred — ${changed.length} notes changed since indexing (over the ${CATCHUP_MAX} limit)`);
            return { reindexed: 0, deferred: changed.length };
        }
        console.debug(`vault-curate: catch-up — re-indexing ${changed.length} changed note(s): ${changed.join(", ")}`);
        this.indexing = true;
        try {
            for (const path of changed) {
                const file = vault.getAbstractFileByPath(path);
                if (file instanceof TFile) await this.indexSingleFile(file);
            }
        } finally {
            this.indexing = false;
        }
        await this.store.flush();
        return { reindexed: changed.length, deferred: 0 };
    }

    removeNote(path: string): void {
        this.store.deleteNote(path);
        // Deletion invalidates the BM25 index just like an upsert does —
        // re-warm so fusion availability has no delete-shaped hole (F7).
        this.plugin.scheduleBM25Warm();
        this.onMutation?.('remove', path);
    }

    async renameNote(oldPath: string, newPath: string, file: TFile): Promise<void> {
        // SQLite has no atomic rename across primary key, so we re-index the file
        // under the new path then delete the old row. Cheaper than a full re-embed
        // would be a row-level update, but renames are rare enough that this is fine.
        // 014 D6#5: MUST go through removeNote (not store.deleteNote directly) so
        // the rename fires a 'remove' hook for oldPath — bypassing it leaves the
        // old node permanently stranded in the k-NN graph, and the revision
        // backstop cannot see it (the upsert hook absorbs the revision bump).
        // The extra scheduleBM25Warm inside removeNote merges into the same
        // debounce window as the one indexSingleFile schedules — no behaviour
        // change beyond the hook.
        this.removeNote(oldPath);
        await this.indexSingleFile(file);
    }

    /**
     * 007 D4 self-healing backfill: embed descriptions for notes whose
     * desc_vec is NULL (schema v3 upgrade left existing rows NULL and an
     * unchanged mtime never re-indexes them). Descriptions only — no chunk
     * re-embed — so a full-vault backfill costs seconds, not minutes.
     */
    private async backfillDescVecs(): Promise<void> {
        const pending = this.store.listDescBackfillPending(this.plugin.settings.minDescChars);
        if (pending.length === 0) return;
        // Silent multi-minute background work reads as "nothing happened" and
        // users reach for manual full rebuilds (dogfood finding, twice) — show
        // progress for any non-trivial backfill.
        const progress = pending.length > 20
            ? new Notice(t.noticeDescBackfill(pending.length), 0)
            : null;
        console.debug(`vault-curate: desc backfill → ${pending.length} descriptions to embed`);
        let written = 0;
        let failedBatches = 0;
        try {
            for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
                if (this.store.isDisposed) return;
                const mapped = pending
                    .slice(i, i + EMBED_BATCH_SIZE)
                    .map(p => ({ path: p.path, input: denoiseForEmbed(t2sForEmbed(p.description)) }));
                // Denoise-empty descriptions get the zero-length sentinel so
                // they leave the pending set — skipping them silently meant
                // infinite retry on every update() AND a spurious startup
                // update-kick for affected vaults (audit C2).
                for (const p of mapped) {
                    if (p.input.trim().length === 0) this.store.setDescVec(p.path, new Float32Array(0));
                }
                const batch = mapped.filter(p => p.input.trim().length > 0);
                if (batch.length === 0) continue;
                try {
                    const vecs = await this.provider.embed(batch.map(p => p.input));
                    batch.forEach((p, j) => {
                        if (vecs[j]) {
                            this.store.setDescVec(p.path, vecs[j]);
                            written++;
                        }
                    });
                } catch (err) {
                    // One bad batch must not kill the whole pass — skipped
                    // notes stay NULL and the self-healing query retries them
                    // on the next update().
                    failedBatches++;
                    console.warn(`vault-curate: desc backfill batch failed (notes ${i}-${i + batch.length})`, err);
                }
            }
        } finally {
            progress?.hide();
        }
        await this.store.flush();
        new Notice(t.noticeDescBackfillDone(written), 5000);
        console.debug(`vault-curate: desc backfill complete (${written} written, ${failedBatches} failed batches)`);
    }

    /** Embed one file end-to-end. Returns false on failure (logged). */
    private async indexOne(file: TFile, incomingSet: Set<string>, h1Collisions?: Set<string>): Promise<boolean> {
        if (this.store.isDisposed) return false;
        const t0 = Date.now();
        try {
            const content = await this.plugin.app.vault.cachedRead(file);
            const fullBody = stripFrontmatter(content);
            // Cap per-note indexing cost: huge files (e.g. embedded PDFs,
            // financial-report dumps) would otherwise dominate the total
            // rebuild time. The dropped tail is unsearchable, which is a
            // worthwhile trade for keeping the worst-case file under a few
            // seconds. Phase 8 Settings UI will expose this knob.
            const cap = this.plugin.settings.maxIndexableChars;
            const body = cap > 0 && fullBody.length > cap ? fullBody.slice(0, cap) : fullBody;
            if (fullBody.length > body.length) {
                console.debug(`vault-curate: ${file.path} truncated ${fullBody.length} → ${body.length} chars`);
            }
            const title = this.extractTitle(file, h1Collisions);
            const description = this.extractDescription(file);
            const tier = this.computeTier(file, incomingSet);

            const chunks = splitChunks(body, title, {
                chunkSize: this.plugin.settings.chunkSize,
                chunkOverlap: this.plugin.settings.chunkOverlap,
            });
            console.debug(`vault-curate: indexing ${file.path} — ${chunks.length} chunks (${body.length} chars)`);

            // Embed in mini-batches so very long notes don't blow request size.
            const chunkVecs: Float32Array[] = [];
            for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
                if (this.store.isDisposed) return false;
                const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
                const tBatch = Date.now();
                // Embedding input is t2s-converted (008 D3) then denoised
                // (007 D1); chunks.content below keeps the raw Traditional
                // text so BM25 + snippets are unaffected.
                const vecs = await this.provider.embed(batch.map(c => denoiseForEmbed(t2sForEmbed(c.content))));
                console.debug(`vault-curate: embedded batch of ${batch.length} (${Date.now() - tBatch}ms)`);
                chunkVecs.push(...vecs);
            }

            if (this.store.isDisposed) return false;
            if (chunkVecs.length === 0) {
                console.warn(`vault-curate: empty body, no chunks for ${file.path}`);
                this.emptySkippedCount++;
                return false;
            }

            const bodyVec = meanPool(chunkVecs);

            // 007 D4: description gets its own embedding for weighted
            // note-vector composition. Too-short descriptions are noise —
            // treat as absent (minDescChars, D5).
            let descVec: Float32Array | null = null;
            if (description && description.length >= this.plugin.settings.minDescChars) {
                const descInput = denoiseForEmbed(t2sForEmbed(description));
                if (descInput.trim().length > 0) {
                    descVec = (await this.provider.embed([descInput]))[0] ?? null;
                } else {
                    // Denoises to nothing (e.g. pure symbol runs): store a
                    // zero-length sentinel, NOT null — null re-enters the
                    // backfill pending set on every update() forever (audit
                    // C2). Read side: length mismatch → compose falls back
                    // to the pure body vector.
                    descVec = new Float32Array(0);
                }
            }
            if (this.store.isDisposed) return false;

            this.store.upsertNote({
                path: file.path,
                mtime: file.stat.mtime,
                title,
                description,
                tier,
                bodyVec,
                bodyDim: bodyVec.length,
                indexedAt: Date.now(),
                descVec,
            });

            this.store.upsertChunks(file.path, chunks.map((c, i) => ({
                notePath: file.path,
                chunkIndex: c.chunkIndex,
                content: c.content,
                vec: chunkVecs[i],
            })));

            console.debug(`vault-curate: ${file.path} indexed in ${Date.now() - t0}ms`);
            return true;
        } catch (err) {
            console.warn(`vault-curate: failed to index ${file.path} after ${Date.now() - t0}ms`, err);
            return false;
        }
    }

    private async ensureProviderReady(): Promise<void> {
        if (await this.provider.isReady()) return;
        console.debug(`vault-curate: warming up ${this.provider.displayName}...`);
        const t0 = Date.now();
        await this.provider.warmup();
        console.debug(`vault-curate: warmup done in ${Date.now() - t0}ms, dim=${this.provider.dimension}, modelId=${this.provider.modelId}`);
    }

    private writeIndexMeta(): void {
        this.store.setMeta("embedding_provider", this.provider.providerType);
        this.store.setMeta("embedding_model_id", this.provider.modelId);
        this.store.setMeta("embedding_dim", String(this.provider.dimension));
        this.store.setMeta("last_indexed_at", new Date().toISOString());
        this.store.setMeta("cjk_tokenizer_version", TOKENIZER_VERSION);
        // Sticky flag: once we've ever finished a rebuild, auto-index on
        // file events stays enabled even if clearAllData wipes the four
        // index-state meta keys (e.g. mid-provider-switch crash).
        this.store.setMeta("bootstrapped", "1");
    }
}
