<div align="center">

# Vault Curate

[![Release](https://img.shields.io/github/v/release/notoriouslab/vault-curate?style=flat-square)](https://github.com/notoriouslab/vault-curate/releases)
[![License](https://img.shields.io/github/license/notoriouslab/vault-curate?style=flat-square)](LICENSE)
[![Obsidian Desktop](https://img.shields.io/badge/Obsidian-Desktop-7C3AED?style=flat-square&logo=obsidian)](https://obsidian.md/)
[![WebGPU Accelerated](https://img.shields.io/badge/WebGPU-Accelerated-FF6A00?style=flat-square)]()
[![Ollama Optional](https://img.shields.io/badge/Ollama-Optional-000?style=flat-square)](https://ollama.com/)
[![Last Commit](https://img.shields.io/github/last-commit/notoriouslab/vault-curate?style=flat-square)](https://github.com/notoriouslab/vault-curate)

**Find, connect, and rediscover your notes.**

A local-first second brain for Obsidian — semantic search · relation graph · semantic paths · Hot/Cold rediscovery · strong Chinese/CJK · WebGPU on-device · no API keys

[繁體中文](https://github.com/notoriouslab/vault-curate/blob/main/README.zh-TW.md)

![Vault Curate](./docs/vault-curate.png)

</div>

---

## Why Vault Curate?

Finding a note is only the first step. The harder parts come after: *seeing* how notes connect — including the links you never drew — and not letting good notes sink out of sight. Obsidian's built-in search is literal (think "prayer", miss "devotional"), its graph shows only the links you made by hand, and old notes quietly fall off your radar.

[Andrej Karpathy shared](https://venturebeat.com/data/karpathy-shares-llm-knowledge-base-architecture-that-bypasses-rag-with-an/) his vision of LLM-maintained knowledge bases — letting AI "compile" your notes into structured wikis. Compelling, but it asks you to hand over full editorial control. **Vault Curate takes a different stance: AI should help you *see*, not think for you.**

### Three differentiators

| Feature | How it works |
|---|---|
| **A closed loop: find → connect → rediscover** | Semantic search (hybrid BM25 + embeddings + fuzzy) finds the note; a relation graph and semantic paths surface related notes you never linked; Hot/Cold tiering resurfaces ones you'd forgotten. Each exists elsewhere as a separate single-point plugin — combining all three is what makes this a second brain, not just a search box. |
| **Helps you see, not think for you** | No background LLM calls, no auto-rewriting your notes, no chatbot answering *for* you. AI curation (descriptions, grouped MOCs) is opt-in and explicit. You stay the editor of your own vault. |
| **Local-first, strong on Chinese/CJK** | Runs on-device via WebGPU (~110 MB model once, 5,004 chunks in about **1m23s**; WASM fallback works too), no API keys. The built-in `bge-small-zh-v1.5` gives Chinese names, religious terms, and colloquial phrases an edge generic multilingual models miss — switch to Ollama/OpenAI for other languages. |

---

## How it works: find → connect → rediscover

Four layers form one closed loop. The first three are zero-config and work out of the box; the fourth (curation) is off by default and only runs when you explicitly turn it on.

![Semantic relation overview](./docs/concept-graph.png)

### 🔍 Find: semantic search

Search by meaning, not just literal characters. Three signals fused via [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) (k=60):

| Path | Catches |
|---|---|
| **BM25** (pure TS, CJK trigram) | Exact phrases, keyword combinations |
| **Semantic embedding** | Different wording, same meaning |
| **Fuzzy title** (Jaro–Winkler) | Typos, spelling variants |

- Cmd/Ctrl+P → `Vault Curate: Semantic search (modal)` for a quick jump; the sidebar **Search** tab for persistent results.
- **Find similar notes**: right-click any `.md` → **VC: Find similar notes**; results land in the sidebar and drag straight to Canvas. Similarity is template-resistant (since 1.2.0): markdown structure symbols are stripped from the embedding input and the frontmatter `description` blends into the ranking vector, so a person card finds *that person's* conversations, not its nine template siblings. Embedding input is additionally converted Traditional→Simplified (since 1.2.2; stored text, keyword search, and snippets stay Traditional) to sharpen ranking on Traditional-Chinese vaults.

![Search results + Canvas drag](./docs/search-canvas.png)

### 🕸 See connections: relation graph / semantic path / expand in place

Search finds a single note; this layer shows how notes relate — including the links you never drew by hand.

**Relation graph (Canvas)** — generate an editable Obsidian Canvas around any note: the note in the center, its top-K semantic neighbors laid out radially, every edge labeled with its similarity score.

- **Purple edges** = semantically close but **not yet linked** — invisible connections the native graph view can't show you
- **Gray edges** (with direction arrows) = notes you've already wikilinked
- **Cyan nodes** = Cold notes

Entry points: the command palette, right-click **VC: Generate relation graph**, or the **Graph** button on the Discover sidebar. Each run writes a fresh timestamped `.canvas` into the folder set under Advanced → Relation graph folder (default `Vault Curate Canvases`) — your edited graphs are never overwritten.

![Relation graph — semantic neighborhood on Canvas](./docs/relation-graph.png)

**Semantic path (Canvas)** — pick any two notes and get the **chain of stepping-stone notes** that connects them: a widest-path search over the vault's semantic k-NN graph, judged by the chain's *weakest* hop so one far-fetched link can't hide behind strong ones. Run **Generate semantic path (Canvas)** on the start note, then pick the destination in the fuzzy picker. If no chain of consistently strong links exists, you get an honest "not connected" notice with the actual numbers — that's information, not an error. The underlying graph builds on demand (~4s on a 2.5k-note vault) and is reused for repeat queries until the index changes.

**Expand in this graph** — right-click any node inside a generated canvas → **VC: Expand in this graph** grows the graph *in place*: the clicked note's neighborhood slots into free space around it, notes already on the canvas get connecting edges instead of duplicates, and a note pointed at by two or more edges turns **orange** (several expansions independently converged on it, which usually means it matters). Your layout edits and manually applied colors are never touched.

**Apply purple edges as wikilinks** (since 1.4.0) — the graph suggests, you decide, one click makes it real. Right-click a generated `.canvas` (or run the command) → a checkbox dialog lists every purple edge grouped by source note; Cmd/Ctrl+hover any name for a native page preview. Checked pairs are written into the notes' **Related** section as real wikilinks — both notes by default, source-only via **Advanced → Bidirectional promotion** — and the edges turn gray with direction arrows on the spot. Nothing is written unchecked, and accepted suggestions never come back as suggestions. The section heading is customizable (**Advanced → Related section heading**).

Since 1.4.0, "related" itself got smarter: Find Similar, the relation graph, and current-note Discover fuse your frontmatter **tags** (as a keyword signal) with semantic similarity, so notes that merely share your writing style stop crowding out notes that share the topic. No tags? Pure semantic ranking, exactly as before.

### ♻️ Rediscover: Hot/Cold tiering + Discover

A good note shouldn't cease to exist just because you forgot it. Notes are auto-tiered by **internal links + recency**: **Hot** (linked, or created/edited recently — any edit counts as a deliberate touch; merely opening a note does not), **Cold** (orphan and untouched for a while). The cutoff is tunable under Advanced → Hot window (days) and applies instantly — tiers are derived live at query time.

Discover works on **notes**, not query strings — it actively surfaces semantically related Cold notes you haven't touched recently:

- **Current note**: opening a file surfaces related notes ranked purely by relatedness, with Cold ones visually highlighted ("you haven't read this one")
- **Global**: forgotten notes most related to your **recent focus** — the notes you've recently edited or created, their topic tags, and their semantic centroid — grouped by top-level folder so each corner of your vault surfaces its own best forgotten notes. Intentional blind-spot mining
- Results export to a topic-grouped Map of Content via **Generate MOC** (falls back to a flat MOC when results are too few or too similar)

![Discover sidebar — current note](./docs/discover-current-note.png)

### ✨ Curate (optional, off by default)

Turn it on under **Settings → AI Curation → Enable AI curation** to unlock three actions — all manually triggered, never running in the background:

- Generate a description + tags into a single note's frontmatter
- Run description generation across the sidebar's search / discover results in a batch
- Generate a **topic-grouped MOC** via HDBSCAN clustering + LLM naming

The LLM provider is configured separately under **Settings → AI Curation** (local Ollama or any OpenAI-compatible endpoint).

---

## Getting started

**Requirements**: [Obsidian](https://obsidian.md/) desktop (v1.0.0+). The advanced paths (Ollama / OpenAI-compatible) additionally need a local [Ollama](https://ollama.com/) instance or any OpenAI-compatible server.

### Installation

**From Community plugins (recommended)**
1. Open **Settings → Community plugins**, make sure **Restricted mode** is off, and click **Browse**
2. Search **Vault Curate**, then click **Install** → **Enable**

**Via BRAT (optional, tracks GitHub releases)**
1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community plugins
2. Cmd/Ctrl+P → `BRAT: Add a beta plugin for testing` → enter `notoriouslab/vault-curate`, then enable
3. New releases are picked up automatically (or on demand via `BRAT: Check for updates to all beta plugins`)

**Manual install**
1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/notoriouslab/vault-curate/releases) (the two `.wasm` runtimes are fetched automatically on first launch)
2. Copy them into `.obsidian/plugins/vault-curate/` in your vault, then enable in **Settings → Community plugins**

> **Tip:** If your vault is Git-tracked, add `.obsidian/plugins/*/data.json` and `.obsidian/plugins/*/index.sqlite` to `.gitignore`.

### First launch

The **Welcome to Vault Curate** modal opens automatically: under **Embedding provider** pick **Built-in (on-device, WebGPU)**, then click **Index my vault now**. After the ~110 MB model download and WebGPU indexing finish, click the sidebar compass icon and start searching.

---

## Reference

### Commands

From the Command Palette (Cmd/Ctrl+P), type `Vault Curate:` to see them all.

| Command | What it does | Requires |
|---|---|---|
| `Semantic search (modal)` | Modal-style semantic search with quick jump | always available |
| `Open search panel` | Open the sidebar panel | always available |
| `Find similar notes` | Find semantically related notes to the active `.md` | always available |
| `Rebuild index` | Wipe the existing index and re-index everything | always available |
| `Update index` | Incremental update (re-index files with newer mtime) | always available |
| `Discover related Cold notes` | Global discover: forgotten notes most related to your recent focus, grouped by folder | always available |
| `Generate relation graph (Canvas)` | Editable Canvas of the active note's semantic neighborhood | always available |
| `Generate semantic path (Canvas)` | Widest-path chain between the active note and a picked destination | always available |
| `Apply purple edges as wikilinks` | Promote a canvas's purple (unlinked) edges into real wikilinks via a checkbox dialog | a `.canvas` is active |
| `Generate description for active note` | LLM-write description + tags to the active file's frontmatter | AI curation on |
| `Generate descriptions for current results` | Batch description for the current sidebar results | AI curation on |
| `Generate MOC (topic-grouped)` | HDBSCAN cluster + LLM-name each group | AI curation on |

Right-click menus expose these directly on a note: **VC: Find similar notes**, **VC: Generate relation graph**, **VC: Generate semantic path**, **VC: Expand in this graph** (while a `.canvas` is open), and **VC: Generate description** (AI curation on). Right-clicking a `.canvas` file offers **VC: Apply purple edges as wikilinks**.

### Settings

| Section | Settings | Default |
|---|---|---|
| **Quick setup** | Embedding provider (Built-in / Ollama / OpenAI-compatible); excluded folders | Built-in; empty |
| **AI Curation** | Enable toggle; LLM provider; LLM model | off; Ollama; qwen3:1.7b |
| **Advanced** | top results, min score, relation graph folder, related section heading, bidirectional promotion, Hot window (days), default search scope, chunk size + overlap, synonym list, auto-index toggle, rebuild + update buttons, index stats | see panel |

Changing the embedding provider or model triggers a confirmation modal — the index is wiped and rebuilt.

### Troubleshooting

- **A full rebuild right after a major OS update can be much slower than usual** — the system is busy reindexing itself (Spotlight, iCloud, shader caches). It's transient: speeds return to normal once the post-update dust settles; nothing in the plugin needs fixing.

---

## Privacy & security

Three embedding modes, picked from **Quick setup → Embedding provider**:

| Mode | Where embeddings run | Where note text goes |
|---|---|---|
| **Built-in** | On-device WebGPU / WASM | Stays on your device |
| **Ollama (local daemon)** | Local Ollama daemon on 127.0.0.1 | Stays on your device |
| **OpenAI-compatible API** | Any endpoint you point it at — local (LM Studio, llama.cpp, …) or remote (OpenAI etc.) | Depends on the endpoint you choose; may leave your device |

The same applies to AI curation (description / MOC naming), which uses an independently-configured LLM endpoint.

**No telemetry. No usage tracking. Nothing is sent to any server unless you configure a remote endpoint.**

### Audit disclosures

The Obsidian Developer Dashboard's automated audit may flag the following items on this plugin. They are intentional and disclosed here for transparency:

- **Vault enumeration** (`vault.getMarkdownFiles()`): The indexer needs to walk the full list of markdown files in your vault to build the semantic index. The "excluded folders" setting (Settings → Advanced) lets you scope this — e.g. excluding `_templates/`, `.trash/`, or any folder you don't want indexed. No file is read until it's in the included set.
- **Dynamic code execution** (`new Function` in bundled `@huggingface/transformers`): The Hugging Face Transformers library uses `new Function` internally to create type-safe method dispatchers during model loading. Vault Curate's own source code contains **zero** `eval()` or `new Function()`. We bundle the upstream library as-is to avoid divergence; the dynamic dispatch happens only inside the embedding model's tokenizer/inference setup, not on any vault content.
- **Direct filesystem access**: The bundled `sql.js` ships an Emscripten output with a Node.js fallback path that imports `node:fs` / `node:crypto`. These branches are dead code in Obsidian's renderer process (gated by `process.type !== "renderer"`). As of v1.0.3, the esbuild config strips those `require()` strings from the released bundle so the audit no longer sees them.

### 🔒 About API key storage

Vault Curate, like every Obsidian plugin, stores its settings (including any OpenAI API key) as plain text in `<vault>/.obsidian/plugins/vault-curate/data.json`. This is Obsidian's plugin storage mechanism, not a vault-curate-specific design choice.

If your vault syncs to a cloud service (iCloud / Dropbox / Google Drive) or pushes to a public Git repository, you should:

1. Add `.obsidian/plugins/vault-curate/data.json` to your sync exclusion list or `.gitignore`
2. Or use the **Built-in** model / **Ollama** path — neither requires an API key

---

## Tech Stack

- **TypeScript** + **esbuild** (two-stage bundle for worker + main)
- **sql.js** (SQLite via WASM) for the storage layer — replaces v0.x's `data.json` / `index.json`
- **Pure-TS BM25+** (`src/storage/bm25.ts`) for CJK-aware full-text search (no native FTS5 dependency)
- **`@huggingface/transformers`** + **`bge-small-zh-v1.5` q8** (~110 MB, WebGPU/WASM) for on-device embeddings
- **`hdbscan-ts`** for topic clustering (MOC)
- **Reciprocal Rank Fusion** (k=60) combining BM25 + semantic + fuzzy
- **Optional**: [Ollama](https://ollama.com/) / any OpenAI-compatible endpoint for higher-end embedding or LLM models

---

## Development

```bash
git clone https://github.com/notoriouslab/vault-curate.git
cd vault-curate
npm install
npm run dev    # watch mode
npm run build  # production build
npm test       # vitest unit tests
```

---

## License

[MIT](./LICENSE)
</content>
</invoke>
