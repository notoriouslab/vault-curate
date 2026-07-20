# Changelog

## 1.3.0 — 2026-07-20

Relation-graph release. Both features grew out of community requests on the Chinese Obsidian forum (forum-zh #61655): connect any two notes through their semantic stepping stones, and grow an existing graph in place.

### Added
- **Semantic path (Canvas).** Pick a destination note and get the chain that connects it to the active note: a widest-path (bottleneck) search over an on-demand semantic k-NN graph — the chain is judged by its *weakest* hop, so one far-fetched link can't be papered over by strong ones. Output is a left-to-right editable Canvas: endpoints green, intermediate nodes tier-colored, every hop labeled with its similarity, un-linked hops purple (same encoding as the relation graph). Entry points: command palette `Generate semantic path (Canvas)` or right-click **VC: Generate semantic path**.
- **Honest "not connected" verdicts.** When the best chain's weakest hop falls below the graph's own 45th-percentile edge similarity, you get a notice with both numbers instead of a misleading chain. The threshold is percentile-anchored to each vault's/model's own score distribution, so it holds across embedding providers.
- **Expand in this graph.** Right-click any node inside a generated canvas → **VC: Expand in this graph** appends that note's semantic neighborhood *into the same canvas* (atomic read-modify-write; your layout edits are preserved — verified against Obsidian's canvas autosave). New nodes slot into free space around the clicked node; neighbors already on the canvas get a connecting edge instead of a duplicate node; a note pointed at by 2+ edges turns **orange** — several expansions independently converged on it. User-applied colors are never overwritten.
- The k-NN graph is memoized per index revision: repeat path queries skip the build entirely (first build ~4s on a 2,500-note vault; an estimate is shown for large vaults).

### Notes
- The k-NN graph applies the same-folder cap (default 3) per node, so template siblings don't crowd out cross-folder connections — chains route through meaningful bridges.
- Corrupted (NaN) embeddings are excluded from the graph at three layers (build, path search, threshold), so one bad note can't silently break verdicts.
- Known limitation: cyan and orange are also user-pickable Canvas palette colors; nodes hand-painted in exactly those two shades are indistinguishable from tool markings and may be repainted by hub detection.
- Worker-izing the first graph build (for 10k-note vaults) is on the backlog together with the BM25 index worker.

## 1.2.2 — 2026-07-18

Retrieval-quality release (plus the 1.2.0 audit compliance fixes, folded in unreleased).

### Changed
- **Find similar / relation graph now cap same-folder results** (hidden setting `sameFolderCap`, default 3, 0 disables). Template siblings live in the same folder and — once generic "hub" notes stopped crowding the list — tended to refill it; the cap hands those slots to the note's actual related content instead. Topic folders are unaffected in practice (the cap only bites when 4+ same-folder notes out-rank everything else).
- **Embedding input is converted Traditional→Simplified Chinese before encoding.** bge-small-zh is trained predominantly on Simplified Chinese; converting only the embedding input (a bundled 4,105-entry character table — stored text, keyword search, snippets, and the description generator all stay Traditional) moves vectors into the model's best-trained token space. Measured on a 2,500-note Traditional-Chinese vault: true positives hold or improve while unrelated "hub" notes drop 3-4x in rank. Queries convert through the same table, so both sides always share one space. Simplified-Chinese vaults are unaffected (conversion is a no-op).
- Upgrading triggers a one-time re-embed of CJK-bearing notes (effectively the whole index on a Chinese vault — the standard progress notice shows; interrupting is safe and resumes on next launch).
- Settings tab now builds its multi-line provider description with Obsidian's `createFragment`/`createEl` helpers instead of bare `document.createElement` (obsidianmd/prefer-create-el, 4 sites).
- Typed-array construction in the BM25 index build uses `new Array<string>(n)` — resolves one unsafe-`any` assignment warning.

### Notes
- A Taiwan-phrase mapping layer (e.g. 記憶體→内存) was evaluated and deliberately excluded: on a terminology-consistent vault both query and index convert identically, and benchmarks across person/tech/finance/church note groups showed no measurable gain over character-level conversion. May revisit as an opt-in if mixed-terminology vaults surface in the community.
- The Dashboard's remaining recommendations stay as previously disclosed: vault enumeration (required for index build, scopable via `excludePatterns`), extra `*.wasm` release files (fetched once, cached), and the `PluginSettingTab.display` deprecation (adopting `getSettingDefinitions` would raise `minAppVersion` above 1.7.2 and drop users on 1.7–1.12).
- The 1.2.0 audit also reported attestation verification errors for `main.js`/`styles.css`; `gh attestation verify` passes both against this repository (single attestation for `main.js` from the release workflow at the tagged commit), so provenance is intact on GitHub's side.

## 1.2.0 — 2026-07-17

Search-quality release. Template-heavy notes (person cards, log templates) no longer crowd *Find similar* / Discover / relation-graph results with their template siblings — the genuinely related content now surfaces. Driven by a real-vault case where a person card's own conversation file ranked #10 behind nine sibling cards; after this release it ranks #1.

### Fixed
- **Long notes were systematically under-scored.** Note-level vectors are mean-pooled from chunk vectors without re-normalization, so multi-chunk notes had norm < 1 while rankers assumed unit vectors (dot = cosine). Vectors are now L2-normalized at the read boundary. This alone moved the dogfood case's target conversation from rank #10 to #1 — expect similarity results to change (for the better) across the vault.

### Changed
- **Embedding input is denoised.** Markdown structure symbols (table borders/divider rows, block/bar characters like `█▃▅`, middle-dot runs) are stripped from the text fed to the embedding model. Shared template symbols dominated note-to-note cosine for templated notes. Stored chunk text is untouched — keyword search and snippets are unaffected. Single middle dots (CJK name separators, e.g. 趙·雲) are preserved.
- **Note ranking vector now blends the frontmatter `description`.** `noteVec = normalize(0.5·desc + 0.5·body)` when a description (≥10 chars) exists; body-only otherwise. A semantic description pins *who/what the note is about*, which plain body text can't when bodies share a template. Blend weight is tunable via `descWeight` in `data.json` (no UI control on purpose).
- **Description generator sees content, not template.** Sampling now denoises first and takes head 1200 + tail 800 chars (personal content in templated notes tends to live at the end), and the prompt forbids describing the note's format/structure. Previously the LLM described the template ("contains statistics tables…") for exactly the notes that needed a semantic description most.

### Performance
- **Keyword (BM25) search is now ~1000x faster on large vaults.** Previously every search re-tokenized the entire corpus and scored every document (~2s per query at 10k chunks — long-standing debt predating this release). BM25 now runs over a prebuilt compact inverted index (typed-array postings, ~45MB for a 1M-term vocabulary): measured 2,000ms → under 1ms per query on a 2,500-note vault. The index builds once at the end of an indexing pass (or lazily on the first search of a session, ~3s) and rebuilds automatically after edits. Ranking output is byte-identical to the previous implementation (pinned by equivalence tests).

### Added
- **Descriptions are keyword-searchable.** Each note's `description` joins the BM25 pool as a virtual document — terms that appear only in the description now hit in search.
- **Zero-effort upgrade.** First launch after upgrading runs a one-time incremental pass: only notes containing strippable symbols are re-embedded (16% of the dogfood vault, not a full rebuild), and existing descriptions get their embeddings backfilled (descriptions only — seconds per thousand notes). A progress notice shows while this runs; interrupting is safe (it resumes on next launch).

### Notes
- Hidden settings: `descWeight` (default 0.5, validated by a two-sided boundary scan — higher values start sacrificing true positives) and `minDescChars` (default 10).
- Remaining topic-level neighbors (people who discuss the same subjects) are a semantic-resolution limit of the built-in model; a larger embedding model via the Ollama/OpenAI provider raises that ceiling at the cost of speed.

## 1.1.1 — 2026-07-07

Audit compliance patch — addresses type-safety warnings raised by the Obsidian Developer Dashboard on the 1.1.0 audit. No behaviour changes.

### Changed
- Frontmatter access now uses type annotations instead of type assertions (`indexer.ts`, `main.ts`, `search-view.ts`) — resolves one unsafe-`any` assignment and four unnecessary-assertion warnings.
- A vault `rename` event handler now explicitly `void`s its async re-index call (floating-promise warning).
- Removed redundant type assertions in `types.ts` (settings default) and `workers/embeddingWorker.ts` (transformers.js pipeline options) — current typings accept the literals directly. Type-level only; emitted JS is identical.

### Notes
- The Dashboard's remaining recommendations are intentional and already disclosed in the README: vault enumeration (required for index build, scopable via `excludePatterns`) and extra release files (`*.wasm` fetched once at first run and cached). The `PluginSettingTab.display` deprecation (Obsidian 1.13+) is deferred — migrating to `getSettingDefinitions` would raise `minAppVersion` from 1.7.2 and drop users on 1.7–1.12.

## 1.1.0 — 2026-07-07

New feature, from forum-zh thread #61655 community feedback.

### Added
- **Relation graph (Canvas)**. Generate an editable Obsidian Canvas around any note: center note plus its top-K semantic neighbors laid out radially, every edge labeled with its similarity score. Purple edges mark notes that are semantically close but not yet wikilinked — connections the native graph view can't surface; gray edges (with direction arrows) mark existing wikilinks; cyan nodes mark Cold notes. Three entry points: command palette (`Generate relation graph (Canvas)`), file right-click (`VC: Generate relation graph`), and a **Graph** button on the Discover sidebar (targets the pinned note when pinned). Right-click any node inside the generated canvas to expand one hop further.
- **Relation graph folder** setting (Advanced). Generated `.canvas` files are written to this folder (default `Vault Curate Canvases`; empty = vault root) with a timestamped filename — an edited graph is never overwritten by a later run.

### Notes
- Zero new dependencies; the graph is assembled from the existing note-level embedding index. Generation reuses the *Find similar notes* similarity pass, so it is instant even on large vaults.

## 1.0.4 — 2026-06-02

UX patch from forum-zh thread #61655 community feedback.

### Fixed
- **Duplicate-looking titles in result lists**. Template-generated notes that share the same `# H1` heading (a common pattern for clinical / journaling / log templates) previously all rendered with the same title in Search / Discover lists, making them indistinguishable. The H1 fallback now performs a collision check across the vault — H1s that appear in 2+ files automatically fall back to `file.basename` so each note remains visually unique. Frontmatter `title:` (when present) still wins unconditionally.

### Notes
- Existing indexes auto-migrate on the next **Update** — files whose stored title differs under the new rule are re-indexed transparently. No manual Rebuild required.

## 1.0.3 — 2026-05-21

Audit compliance patch — addresses three findings raised by the Obsidian Developer Dashboard auto-audit.

### Changed
- **Build**: esbuild now strips `require("node:fs")` and `require("node:crypto")` references from the bundled `sql.js` Emscripten output. Those branches are dead code in Obsidian's renderer process; removing the syntactic references resolves the Dashboard's "Direct Filesystem Access" warning without changing runtime behaviour.

### Docs
- README + README.zh-TW: added an "Audit disclosures" section explaining the remaining audit findings — vault enumeration (necessary for indexing; user-scopable via `excludePatterns`), and `new Function` inside the bundled `@huggingface/transformers` (model-loading internals only; Vault Curate's own source contains zero `eval` / `new Function`).

## 1.0.2 — 2026-05-21

UX patch from community feedback (forum-zh thread #61655) + own dogfood.

### Fixed
- LLM model dropdown stuck on "Loading..." when using built-in WebGPU embedding + AI curation. The dropdown now correctly fetches Ollama models even when the embedding provider is set to `wasm`. ([#7](https://github.com/notoriouslab/vault-curate/issues/7))

### Added
- **Hover preview** integration for Search and Discover result items. Holding Cmd/Ctrl while hovering a result now shows Obsidian's native Page Preview popup, same as for `[[wikilinks]]`. Registers as a hover source so it can be toggled in Settings → Core plugins → Page preview. ([#6](https://github.com/notoriouslab/vault-curate/issues/6))
- **Pin Discover** sidebar to lock against active-file switching. Click the 📌 button in the Discover toolbar to keep the current note's discovery context visible while you click through to peek at results. Auto-unpins on file delete or when switching to Global mode; rename-aware. ([#6](https://github.com/notoriouslab/vault-curate/issues/6))

### i18n
- 5 new strings for the pin feature (English + Traditional Chinese)

---

Earlier versions: see [GitHub releases](https://github.com/notoriouslab/vault-curate/releases).
