// ============================================================
// vault-curate types
// ============================================================

export type ApiFormat = "ollama" | "openai";
export type EmbeddingProviderType = "wasm" | "ollama" | "openai-compatible";

export interface VaultSearchSettings {
    /** Phase 4 (004 rebrand): which embedding backend to use.
     *  - "wasm"              → built-in Xenova/bge-base-zh q8 (zero-config default)
     *  - "ollama"            → external Ollama (advanced, higher quality)
     *  - "openai-compatible" → external OpenAI-compatible endpoint
     *  Phase 8 will expose this in the Settings UI.
     */
    embeddingProvider: EmbeddingProviderType;
    /** Maximum characters embedded per note. Anything beyond this is dropped
     *  before chunking, capping the worst-case per-note indexing cost. */
    maxIndexableChars: number;
    ollamaUrl: string;
    ollamaModel: string;
    apiFormat: ApiFormat;
    apiKey: string;
    topResults: number;
    minScore: number;
    maxEmbedChars: number;
    /** 007 D5: desc/body blend weight for note-vector composition.
     *  Hidden setting (no UI control) — tune via data.json. */
    descWeight: number;
    /** 007 D5: descriptions shorter than this are treated as absent
     *  (too short = embedding noise). Hidden setting. */
    minDescChars: number;
    /** 008 D7: max results from the query note's own folder in Find
     *  Similar / relation graph (template siblings live together and
     *  crowd out the note's actual content). 0 disables. Hidden setting. */
    sameFolderCap: number;
    hotDays: number;
    searchScope: "hot" | "all" | "cold";
    excludePatterns: string[];
    autoIndex: boolean;
    synonyms: Record<string, string[]>;
    llmModel: string;
    chunkSize: number;
    chunkOverlap: number;
    /** AI curation master switch (design D9). Gates description generation
     *  commands and topic-grouped MOC. Default false — the OnboardingModal
     *  asks the user explicitly on first launch; existing users keep their
     *  saved value because Object.assign only fills missing keys. */
    enableAICuration: boolean;
    /** Semantic Canvas Graph (006): folder for generated .canvas files.
     *  Empty string = vault root. */
    canvasFolder: string;
    /** Purple-edge promotion (010 D7): heading the promoted wikilinks are
     *  appended under. Empty string = follow the interface language
     *  (resolved at use time via t.relatedSectionDefault). */
    relatedSectionTitle: string;
    /** Purple-edge promotion (010 D3): write the wikilink into both notes
     *  of a promoted pair (the semantic relation is symmetric, and the
     *  rescued Cold note keeps a visible trail). Off = source note only. */
    promoteBidirectional: boolean;
    /** Dismissed suggestions (013 D1): pairKey → dismissedAt (ms). A pair
     *  the user rejected is hidden from Find Similar / Discover-current /
     *  the relation graph, pre-truncation so the slot is refilled. Lives
     *  in data.json, never SQLite — survives rebuilds and provider
     *  switches (D9). */
    dismissedPairs: Record<string, number>;
    /** Dismissed notes (013 D1): notePath → dismissedAt (ms). Note-level
     *  set for global discover, which has no anchor note. */
    dismissedNotes: Record<string, number>;
}

export const DEFAULT_SETTINGS: VaultSearchSettings = {
    embeddingProvider: "wasm",
    maxIndexableChars: 60000,
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "qwen3-embedding:0.6b",
    apiFormat: "ollama",
    apiKey: "",
    topResults: 10,
    minScore: 0.5,
    maxEmbedChars: 2000,
    descWeight: 0.5,
    minDescChars: 10,
    sameFolderCap: 3,
    hotDays: 90,
    searchScope: "hot",
    excludePatterns: ["_templates/", "templates/", ".trash/", "3_wiki/"],
    autoIndex: true,
    synonyms: {},
    llmModel: "qwen3:1.7b",
    chunkSize: 2000,
    chunkOverlap: 100,
    enableAICuration: false,
    canvasFolder: "Vault Curate Canvases",
    relatedSectionTitle: "",
    promoteBidirectional: true,
    dismissedPairs: {},
    dismissedNotes: {},
};

/** data.json stores settings only — index lives in SQLite (Phase 4+). */
export interface VaultSearchData {
    settings: VaultSearchSettings;
    /** 010 D6: self-write exemption ledger (path → mtime of the plugin's
     *  own batch write). Not exposed in the Settings UI. */
    selfWrites?: Record<string, number>;
}

export interface SearchResult {
    path: string;
    title: string;
    tags: string[];
    score: number;
    tier: "hot" | "cold";
}

// ============================================================
// MOC 2.0 (v0.4.0) — topic-grouped Map of Content
// ============================================================

export type MocSizeTier = "ok" | "warn" | "block";

export interface Cluster {
    /** -1 = noise; 0+ = cluster index */
    label: number;
    /** Indices into the source results array (SearchResult[]) */
    noteIndices: number[];
}

export interface NamedCluster extends Cluster {
    title: string;
    intro: string;
    /** true = LLM naming failed, using fallback title/intro */
    isFallback: boolean;
}

export interface MocGroupedResult {
    clusters: NamedCluster[];
    /** Collected noise points; null when HDBSCAN produced none */
    miscellaneous: NamedCluster | null;
    totalNotes: number;
    query: string;
}
