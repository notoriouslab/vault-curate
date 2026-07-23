export interface Locale {
    // Settings
    ollamaUrl: string;
    ollamaUrlDesc: string;
    apiFormat: string;
    apiFormatDesc: string;
    apiFormatOllama: string;
    apiFormatOpenAI: string;
    embeddingModel: string;
    embeddingModelDesc: string;
    topResults: string;
    topResultsDesc: string;
    minScore: string;
    minScoreDesc: string;
    maxEmbedChars: string;
    maxEmbedCharsDesc: string;
    hotDays: string;
    hotDaysDesc: string;
    searchScope: string;
    searchScopeDesc: string;
    scopeHot: string;
    scopeAll: string;
    excludePatterns: string;
    excludePatternsDesc: string;
    autoIndex: string;
    autoIndexDesc: string;
    synonymsLabel: string;
    synonymsDesc: string;
    chunkSize: string;
    chunkSizeDesc: string;
    chunkOverlap: string;
    chunkOverlapDesc: string;
    llmModel: string;
    llmModelDesc: string;
    enableAICuration: string;
    enableAICurationDesc: string;
    llmEndpointHeading: string;
    llmEndpointProbing: string;
    llmEndpointReachable: string;
    llmEndpointUnreachable: (reason: string) => string;
    llmEndpointHint: string;
    llmEndpointRecheck: string;
    actions: string;
    rebuildIndex: string;
    rebuildIndexDesc: string;
    rebuildBtn: string;
    indexingBtn: string;
    updateIndex: string;
    updateIndexDesc: string;
    updateBtn: string;
    updatingBtn: string;
    indexStats: string;
    totalNotes: string;
    hot: string;
    cold: string;
    model: string;
    dimensions: string;
    lastIndexed: string;
    // Search
    searchPlaceholder: string;
    searchResults: (n: number) => string;
    indexEmpty: string;
    searchFailed: string;
    searching: string;
    // Commands
    cmdSemanticSearch: string;
    cmdOpenPanel: string;
    cmdFindSimilar: string;
    cmdRebuild: string;
    cmdUpdate: string;
    cmdDescActive: string;
    cmdDescSelected: string;
    menuDescGenerate: string;
    menuFindSimilar: string;
    btnDescGenerate: string;
    ollamaNotReady: string;
    noSimilar: string;
    notIndexed: string;
    similarTo: (title: string) => string;
    descNoLlmConfigured: string;
    descGenerating: (done: number, total: number) => string;
    descGeneratingOne: (name: string) => string;
    descGeneratedOne: (name: string) => string;
    descBatchDone: (ok: number, failed: number) => string;
    descLlmFailed: (name: string) => string;
    descNoEligible: string;
    descAICurationOff: string;
    descOpenSidebarFirst: string;
    apiKeyLabel: string;
    apiKeyDesc: string;
    urlPlaceholder: string;
    apiKeyPlaceholder: string;
    remoteWarning: string;
    httpApiKeyWarning: string;
    selectModel: string;
    // Discover
    tabSearch: string;
    tabDiscover: string;
    discoverCurrentNote: string;
    discoverGlobal: string;
    discoverRelatedTo: (title: string) => string;
    discoverEmpty: string;
    discoverNoIndex: string;
    discoverComputing: string;
    discoverGlobalDesc: string;
    discoverProgress: (done: number, total: number) => string;
    generateMoc: string;
    mocCreated: (path: string) => string;
    mocNoResults: string;
    cmdGlobalDiscover: string;
    scopeCold: string;
    // Settings sections
    sectionQuickSetup: string;
    sectionAICuration: string;
    sectionAdvanced: string;
    embeddingProvider: string;
    embeddingProviderDesc: string;
    embeddingProviderBuiltin: string;
    embeddingProviderOllama: string;
    embeddingProviderOpenAI: string;
    builtinModelNote: string;
    providerSwitchTitle: string;
    providerSwitchBody: (notes: number) => string;
    providerSwitchConfirm: string;
    providerSwitchCancel: string;
    onboardingTitle: string;
    onboardingIntro: string;
    onboardingProviderHeading: string;
    onboardingOllamaDetected: string;
    onboardingOllamaNotDetected: string;
    onboardingOpenaiEndpoint: string;
    onboardingOpenaiModel: string;
    onboardingTestConnection: string;
    onboardingTestOk: string;
    onboardingTestFail: string;
    onboardingAIHeading: string;
    onboardingAIYes: string;
    onboardingAINo: string;
    onboardingAIRequiresLlm: string;
    onboardingIndexNow: string;
    onboardingLater: string;
    backendNotReady: string;
    rerunOnboarding: string;
    rerunOnboardingDesc: string;
    rerunOnboardingBtn: string;
    dimMismatchNotice: (skipped: number) => string;
    // Notices
    noticeIndexEmpty: string;
    noticeIndexing: (done: number, total: number) => string;
    noticeDescBackfill: (total: number) => string;
    noticeDescBackfillDone: (written: number) => string;
    noticeBuildingSearchIndex: string;
    noticeIndexDone: (total: number, hot: number, cold: number, failed: number) => string;
    noticeUpToDate: string;
    noticeUpdated: (updated: number, total: number, hot: number) => string;
    noticeEmptySkipped: (n: number) => string;
    noticeLargeVault: (chunks: number) => string;
    discoverGlobalNoHot: string;
    discoverGlobalNoCold: string;
    discoverGlobalAllFiltered: string;
    discoverPin: string;
    discoverUnpin: string;
    discoverPinnedTo: (title: string) => string;
    discoverPinNoFile: string;
    discoverPinFileGone: string;
    // Semantic Canvas Graph (006)
    cmdGenerateGraph: string;
    menuGenerateGraph: string;
    discoverGraphBtn: string;
    discoverGraphNoFile: string;
    noticeGraphNoResults: string;
    noticeGraphCreated: (path: string) => string;
    // Semantic Path (009)
    cmdSemanticPath: string;
    menuSemanticPath: string;
    pathModalPlaceholder: string;
    pathFilePrefix: string;
    noticePathBuilding: (n: number, estSeconds: number | null) => string;
    noticePathNotConnected: (k: number, hops: number) => string;
    noticePathWeak: (bottleneck: number, threshold: number) => string;
    noticePathSameNote: string;
    noticePathCreated: (path: string) => string;
    noticePathCreateFailed: string;
    // In-place canvas expansion (009 D5)
    menuExpandInCanvas: string;
    noticeExpandAdded: (added: number, linked: number) => string;
    noticeExpandNothingNew: string;
    noticeExpandCrowded: (n: number) => string;
    noticeExpandCollision: string;
    noticeExpandFailed: string;
    settingCanvasFolder: string;
    settingCanvasFolderDesc: string;
    // Purple-edge promotion (010)
    menuPromote: string;
    cmdPromote: string;
    noticePromoteWriting: (pairs: number) => string;
    promoteTitle: string;
    promoteHint: string;
    promoteApply: string;
    promoteCancel: string;
    promoteSelectedCount: (n: number) => string;
    noticePromoteEmpty: string;
    noticePromoteInvalidCanvas: string;
    noticePromoteDone: (links: number, edges: number) => string;
    noticePromoteSkipped: (pairs: number) => string;
    noticePromotePartial: (n: number) => string;
    noticePromoteCanvasFailed: string;
    relatedSectionDefault: string;
    settingRelatedSection: string;
    settingRelatedSectionDesc: string;
    settingPromoteBidirectional: string;
    settingPromoteBidirectionalDesc: string;
    noticeIndexCorrupt: string;
    indexingInProgress: string;
    viewDisplayName: string;
    mocTitleSearch: (query: string) => string;
    mocDescSearch: (query: string) => string;
    mocTitleRelated: (title: string) => string;
    mocDescRelated: (title: string) => string;
    mocTitleGlobal: string;
    mocDescGlobal: string;
    instructNav: string;
    instructOpen: string;
    instructDismiss: string;
    // MOC 2.0
    languageLabel: string;  // e.g. "English" / "繁體中文", embedded in LLM prompts
    cmdGenerateMocGrouped: string;
    mocGroupedDescription: (query: string) => string;
    mocMiscellaneous: string;
    mocMiscIntro: string;
    mocClusteringStatus: (current: number, total: number) => string;
    mocNamingStatus: (current: number, total: number) => string;
    mocTooFewResults: string;
    mocClusteringDegenerate: string;
    mocTooManyResults: (n: number) => string;
    mocConfirmLarge: (n: number, seconds: number) => string;
    mocFallbackGroup: (n: number) => string;
    mocCanceled: string;
    mocLlmUnavailable: string;
    mocClusterNamingPrompt: (languageLabel: string, notesBlock: string) => string;
    // LLM
    llmPrompt: (title: string, content: string) => string;
}

const en: Locale = {
    ollamaUrl: "Server URL",
    ollamaUrlDesc: "Embedding server address",
    apiFormat: "API format",
    apiFormatDesc: "Ollama for Ollama; OpenAI-compatible for llama.cpp, LM Studio, MLX, vLLM, OpenAI, etc.",
    apiFormatOllama: "Ollama",
    apiFormatOpenAI: "OpenAI-compatible",
    embeddingModel: "Embedding model",
    embeddingModelDesc: "Model name (e.g. qwen3-embedding:0.6b, nomic-embed-text, text-embedding-3-small)",
    topResults: "Top results",
    topResultsDesc: "Max results to show in search and Discover",
    minScore: "Minimum score",
    minScoreDesc: "Hide results below this similarity threshold (0.0 – 1.0). Lower = more results, higher = stricter match.",
    maxEmbedChars: "Max embed characters",
    maxEmbedCharsDesc: "Truncate note content for embedding. Notes with a description use the description instead. Rebuild index after changing.",
    hotDays: "Hot days",
    hotDaysDesc: "Notes created or edited within this many days are considered Hot (active) — any edit counts as a deliberate touch, merely opening a note does not. Hot notes have links or recent activity; Cold notes are isolated and surfaced by Discover. Changes take effect immediately, no re-index needed.",
    searchScope: "Default search scope",
    searchScopeDesc: "Hot = linked or recent notes. Cold = isolated notes (great for rediscovery). All = everything.",
    scopeHot: "Hot only",
    scopeAll: "All notes",
    excludePatterns: "Exclude patterns",
    excludePatternsDesc: "Folder prefixes to exclude from indexing and Discover (one per line, e.g. 3_wiki/)",
    autoIndex: "Auto-index on change",
    autoIndexDesc: "Automatically re-embed notes when modified. Keeps Discover results fresh.",
    chunkSize: "Chunk size",
    chunkSizeDesc: "Characters per chunk (rebuild index after changing)",
    chunkOverlap: "Chunk overlap",
    chunkOverlapDesc: "Overlapping characters between chunks",
    synonymsLabel: "Synonyms",
    synonymsDesc: "One per line: keyword = synonym1, synonym2",
    llmModel: "LLM model",
    llmModelDesc: "Model used by AI curation (description / MOC naming). Recommended: qwen3:1.7b for Ollama; gpt-4o-mini for OpenAI-compatible.",
    enableAICuration: "Enable AI curation",
    enableAICurationDesc: "When on, expose Description generation and topic-grouped MOC commands. The LLM reuses the endpoint set above for the embedding provider (Ollama or OpenAI-compatible).",
    llmEndpointHeading: "LLM endpoint status",
    llmEndpointProbing: "Probing…",
    llmEndpointReachable: "✓ Reachable",
    llmEndpointUnreachable: (reason: string) => `⚠ Unreachable: ${reason}`,
    llmEndpointHint: "Start Ollama (ollama.com), or switch the embedding provider above to OpenAI-compatible.",
    llmEndpointRecheck: "Recheck",
    actions: "Actions",
    rebuildIndex: "Rebuild index",
    rebuildIndexDesc: "Re-embed all notes from scratch. Required after adding many new files or changing embedding model.",
    rebuildBtn: "Rebuild",
    indexingBtn: "Indexing...",
    updateIndex: "Update index",
    updateIndexDesc: "Only re-embed new or modified notes. Faster than full rebuild.",
    updateBtn: "Update",
    updatingBtn: "Updating...",
    indexStats: "Index stats",
    totalNotes: "Total notes",
    hot: "Hot",
    cold: "Cold",
    model: "Model",
    dimensions: "Dimensions",
    lastIndexed: "Last indexed",
    searchPlaceholder: "Semantic search...",
    searchResults: (n) => `${n} results`,
    indexEmpty: "Index is empty. Run 'Rebuild index' first.",
    searchFailed: "Search failed",
    searching: "Searching...",
    cmdSemanticSearch: "Semantic search (modal)",
    cmdOpenPanel: "Open search panel",
    cmdFindSimilar: "Find similar notes",
    cmdRebuild: "Rebuild index",
    cmdUpdate: "Update index",
    cmdDescActive: "Generate description for active note",
    cmdDescSelected: "Generate descriptions for current results",
    menuDescGenerate: "VC: Generate description",
    menuFindSimilar: "VC: Find similar notes",
    btnDescGenerate: "Generate description",
    ollamaNotReady: "Cannot connect to Ollama. Please ensure Ollama is running.",
    noSimilar: "No similar notes found",
    notIndexed: "This note is not indexed",
    similarTo: (title) => `Similar to: ${title}`,
    descNoLlmConfigured: "LLM not configured. Set the LLM model in Settings first.",
    descGenerating: (done, total) => `Generating descriptions: ${done}/${total}...`,
    descGeneratingOne: (name) => `Generating description for ${name}...`,
    descGeneratedOne: (name) => `Description added to ${name}`,
    descBatchDone: (ok, failed) => failed > 0
        ? `Done — ${ok} notes, ${failed} failed`
        : `Done — ${ok} notes`,
    descLlmFailed: (name) => `LLM failed for ${name}`,
    descNoEligible: "No notes without a description in the current selection.",
    descAICurationOff: "AI curation is disabled. Enable it in Settings to use this command.",
    descOpenSidebarFirst: "Open the Vault Curate panel and run a search first.",
    apiKeyLabel: "API key",
    apiKeyDesc: "Optional — for servers that require authentication",
    urlPlaceholder: "http://localhost:11434",
    apiKeyPlaceholder: "sk-...",
    remoteWarning: "\u26a0 Remote server — note content will be sent outside your machine",
    httpApiKeyWarning: "\u26a0 API key will be sent in plain text over HTTP. Consider using HTTPS.",
    selectModel: "Select a model",
    tabSearch: "Search",
    tabDiscover: "Discover",
    discoverCurrentNote: "Current note",
    discoverGlobal: "Global",
    discoverRelatedTo: (title) => `Related to: ${title}`,
    discoverEmpty: "No related notes found",
    discoverNoIndex: "Build index first",
    discoverComputing: "Computing...",
    discoverGlobalDesc: "Notes most related to your active thinking but not yet explored",
    discoverProgress: (done, total) => `Computing: ${done}/${total}...`,
    generateMoc: "Generate MOC",
    mocCreated: (path) => `MOC created: ${path}`,
    mocNoResults: "No results to generate MOC from",
    cmdGlobalDiscover: "Discover related Cold notes",
    scopeCold: "Cold only",
    sectionQuickSetup: "Quick setup",
    sectionAICuration: "AI curation",
    sectionAdvanced: "Advanced",
    embeddingProvider: "Embedding provider",
    embeddingProviderDesc: "Where embeddings are computed.\n• Built-in: entirely on-device, never leaves your machine.\n• Ollama: a local daemon you run on 127.0.0.1 — also stays on your machine.\n• OpenAI-compatible: any compatible endpoint, could be local (LM Studio / llama.cpp) OR a remote API (OpenAI etc.) — note content may leave your machine.",
    embeddingProviderBuiltin: "Built-in (on-device, WebGPU)",
    embeddingProviderOllama: "Ollama (local daemon)",
    embeddingProviderOpenAI: "OpenAI-compatible API (local or remote)",
    builtinModelNote: "Model: bge-small-zh-v1.5 (~33M params, ~110MB download on first run). WebGPU accelerated.",
    providerSwitchTitle: "Switch embedding provider?",
    providerSwitchBody: (notes) =>
        `This clears the existing index and re-indexes the whole vault. About ${notes} notes will be re-embedded — estimated 1–10 minutes depending on provider.`,
    providerSwitchConfirm: "Confirm and re-index",
    providerSwitchCancel: "Cancel",
    onboardingTitle: "Welcome to Vault Curate",
    onboardingIntro: "Vault Curate brings high-quality Chinese-friendly semantic search to your vault. Pick where embeddings run.",
    onboardingProviderHeading: "Embedding provider",
    onboardingOllamaDetected: "✓ Ollama detected on localhost:11434",
    onboardingOllamaNotDetected: "⚠ Ollama not running. Install from ollama.com, then reopen this dialog.",
    onboardingOpenaiEndpoint: "Endpoint URL",
    onboardingOpenaiModel: "Model name",
    onboardingTestConnection: "Test connection",
    onboardingTestOk: "✓ Reachable",
    onboardingTestFail: "✗ Not reachable",
    onboardingAIHeading: "Enable AI curation?",
    onboardingAIYes: "Yes — description + topic-grouped MOC",
    onboardingAINo: "No, just search",
    onboardingAIRequiresLlm: "AI curation needs an LLM endpoint. Start Ollama (ollama.com) or switch embedding to OpenAI-compatible.",
    onboardingIndexNow: "Index my vault now",
    onboardingLater: "Skip for now",
    backendNotReady: "Backend not ready — reload the plugin (check console for the init error).",
    rerunOnboarding: "Re-run onboarding",
    rerunOnboardingDesc: "Reopen the first-launch setup modal — useful if you dismissed it earlier and want to revisit provider / AI curation choices.",
    rerunOnboardingBtn: "Open onboarding",
    dimMismatchNotice: (skipped) =>
        `${skipped} notes have a different embedding dimension than the current model. Run "Rebuild index" to recover.`,
    noticeIndexEmpty: "Vault Curate: Index is empty. Run 'Rebuild index' first",
    noticeIndexing: (done, total) => `Vault Curate: Indexing ${done}/${total}...`,
    noticeDescBackfill: (total) => `Vault Curate: embedding ${total} descriptions (one-time upgrade, ~1-3 min)...`,
    noticeDescBackfillDone: (written) => `Vault Curate: description embeddings ready (${written} notes)`,
    noticeBuildingSearchIndex: "Vault Curate: building keyword search index...",
    noticeIndexDone: (total, hot, cold, failed) => {
        const f = failed > 0 ? `, ${failed} failed` : "";
        return `Vault Curate: Done — ${total} notes (${hot} hot, ${cold} cold${f})`;
    },
    noticeUpToDate: "Vault Curate: Index up to date",
    noticeUpdated: (updated, total, hot) =>
        `Vault Curate: Updated ${updated} notes (total: ${total}, hot: ${hot})`,
    noticeEmptySkipped: (n) => `Vault Curate: skipped ${n} empty note(s) — no content to embed`,
    noticeLargeVault: (chunks) =>
        `Vault Curate: indexed ${chunks} chunks. Semantic search may take a few seconds — if it feels slow, try setting search scope to "Hot" in Settings → Advanced.`,
    discoverGlobalNoHot: "No Hot notes yet — add internal links or recent notes to populate Hot, then Discover can surface related Cold notes against them.",
    discoverGlobalNoCold: "No Cold notes — every note in your vault is either linked or recent, so there's nothing to rediscover.",
    discoverGlobalAllFiltered: "All Cold candidates scored below the minimum threshold — lower 'Min score' in Settings → Advanced to surface lower-confidence matches.",
    discoverPin: "Pin",
    discoverUnpin: "Unpin",
    discoverPinnedTo: (title) => `Pinned to: ${title}`,
    discoverPinNoFile: "Open a note first, then pin Discover.",
    discoverPinFileGone: "Pinned note was deleted — Discover unpinned.",
    cmdGenerateGraph: "Generate relation graph (Canvas)",
    menuGenerateGraph: "VC: Generate relation graph",
    discoverGraphBtn: "Graph",
    discoverGraphNoFile: "Open a note first, then generate its relation graph.",
    noticeGraphNoResults: "Vault Curate: No similar notes above the score threshold — graph not created. Lower 'Minimum score' in Advanced settings to widen the net.",
    noticeGraphCreated: (path) => `Vault Curate: Relation graph created — ${path}`,
    cmdSemanticPath: "Generate semantic path (Canvas)",
    menuSemanticPath: "VC: Generate semantic path",
    pathModalPlaceholder: "Select the destination note…",
    pathFilePrefix: "Semantic path",
    noticePathBuilding: (n, estSeconds) => `Vault Curate: Building semantic graph over ${n} notes…${estSeconds ? ` (first build ~${estSeconds}s; repeat queries reuse it)` : ""}`,
    noticePathNotConnected: (k, hops) => `Vault Curate: Not connected within ${hops} hops in the K=${k} neighborhood — these two notes are semantically distant. (That's information, not an error.)`,
    noticePathWeak: (bottleneck, threshold) => `Vault Curate: The strongest chain bottoms out at ${bottleneck.toFixed(3)}, below this graph's threshold ${threshold.toFixed(3)} — no chain of consistently strong links exists. Treating as not connected.`,
    noticePathSameNote: "Vault Curate: Start and destination are the same note — pick a different one.",
    noticePathCreated: (path) => `Vault Curate: Semantic path created — ${path}`,
    noticePathCreateFailed: "Vault Curate: Couldn't write the path canvas file — see console for details.",
    menuExpandInCanvas: "VC: Expand in this graph",
    noticeExpandAdded: (added, linked) => {
        const parts: string[] = [];
        if (added > 0) parts.push(`added ${added} related note${added === 1 ? "" : "s"}`);
        if (linked > 0) parts.push(`drew ${linked} new link${linked === 1 ? "" : "s"} to notes already on the graph`);
        return `Vault Curate: ${parts.join(" and ")}`;
    },
    noticeExpandNothingNew: "Vault Curate: Nothing to add — related notes are already on this graph (or none passed the score threshold).",
    noticeExpandCrowded: (n) => `Vault Curate: This graph now has ${n} nodes — consider starting a fresh one for readability.`,
    noticeExpandCollision: "Vault Curate: Space is tight — some new nodes may overlap. Drag them to tidy up.",
    noticeExpandFailed: "Vault Curate: Couldn't parse this canvas file — no changes were made.",
    settingCanvasFolder: "Relation graph folder",
    settingCanvasFolderDesc: "Where generated .canvas files are saved. Leave empty to use the vault root. If you point this at a folder your sync tool excludes, generated graphs won't sync.",
    menuPromote: "VC: Apply purple edges as wikilinks",
    cmdPromote: "Apply purple edges as wikilinks",
    noticePromoteWriting: (pairs: number) =>
        `Vault Curate: Writing ${pairs} link pairs…`,
    promoteTitle: "Promote purple edges to wikilinks",
    promoteHint: "Each checked note gets a real wikilink with the group's source note — written into both notes' Related section, or only the source note when bidirectional promotion is off — and its edge turns gray. Nothing is written without a check. Cmd/Ctrl+hover a note name to preview it.",
    promoteApply: "Apply",
    promoteCancel: "Cancel",
    promoteSelectedCount: (n: number) => `${n} selected`,
    noticePromoteEmpty: "Vault Curate: No promotable purple edges on this canvas.",
    noticePromoteInvalidCanvas: "Vault Curate: Could not read this canvas file.",
    noticePromoteDone: (links: number, edges: number) =>
        `Vault Curate: Wrote ${links} wikilink${links === 1 ? "" : "s"}, updated ${edges} edge${edges === 1 ? "" : "s"}.`,
    noticePromoteSkipped: (pairs: number) =>
        `Vault Curate: ${pairs} pair${pairs === 1 ? "" : "s"} skipped — the canvas changed while the dialog was open.`,
    noticePromotePartial: (n: number) =>
        `Vault Curate: ${n} write${n === 1 ? "" : "s"} failed — see the developer console.`,
    noticePromoteCanvasFailed: "Vault Curate: Links were written, but the canvas update failed. The graph will self-correct on the next promotion scan.",
    relatedSectionDefault: "## Related",
    settingRelatedSection: "Related section heading",
    settingRelatedSectionDesc: "Heading the promoted wikilinks are appended under (created at the end of the note when missing). Leave empty to follow the interface language.",
    settingPromoteBidirectional: "Bidirectional promotion",
    settingPromoteBidirectionalDesc: "Write the wikilink into both notes of a promoted pair. Turn off to only write into the edge's source note.",
    noticeIndexCorrupt: "Vault Curate: Index file is corrupted. Please rebuild index.",
    indexingInProgress: "Vault Curate: Indexing already in progress",
    viewDisplayName: "Vault Curate",
    mocTitleSearch: (query) => `MOC: ${query}`,
    mocDescSearch: (query) => `Search results for "${query}"`,
    mocTitleRelated: (title) => `MOC: ${title}`,
    mocDescRelated: (title) => `Notes related to "${title}"`,
    mocTitleGlobal: "MOC: Global Discover",
    mocDescGlobal: "Cold notes most related to current Hot notes",
    instructNav: "navigate",
    instructOpen: "open note",
    instructDismiss: "dismiss",
    languageLabel: "English",
    cmdGenerateMocGrouped: "Generate MOC (topic-grouped)",
    mocGroupedDescription: (query) => `Topic-grouped MOC from query: ${query}`,
    mocMiscellaneous: "Miscellaneous",
    mocMiscIntro: "Notes related to the query but not fitting the above groups.",
    mocClusteringStatus: (current, total) => `Grouping ${current}/${total} notes...`,
    mocNamingStatus: (current, total) => `Naming group ${current}/${total}...`,
    mocTooFewResults: "Less than 5 results, generating flat MOC instead",
    mocClusteringDegenerate: "Results share a single topic; generating flat MOC instead",
    mocTooManyResults: (n) => `Too many results (${n}). Narrow down with tag or folder filter first.`,
    mocConfirmLarge: (n, seconds) => `${n} notes will take ~${seconds}s to organize. Continue?`,
    mocFallbackGroup: (n) => `Group ${n}`,
    mocCanceled: "MOC generation canceled. Partial result saved.",
    mocLlmUnavailable: "LLM unavailable, clusters saved without names",
    mocClusterNamingPrompt: (languageLabel, notesBlock) => `You are organizing a knowledge vault. Below are notes that have been grouped together because they discuss related topics. Based on the common theme, produce:

- title: a concise heading (3-8 words or ${languageLabel} characters)
- intro: 1-2 sentences (40-80 characters) describing what ties these notes together

Notes:
${notesBlock}

Respond with valid JSON only, in ${languageLabel}:
{"title": "...", "intro": "..."}`,
    llmPrompt: (title, content) => `Task: Generate a description and tags for this note.

Rules:
1. Description in English, 50-100 words
2. Description must describe specific content, never repeat the title
3. Describe only the note's subject matter — never its format or structure (tables, statistics, charts, sections)
4. Tags in English, 3-5 tags, no # prefix, no spaces
5. Reply only in JSON

{"description": "...", "tags": ["...", "...", "..."]}

Note title: ${title}

Note content:
${content}`,
};

const zhTW: Locale = {
    ollamaUrl: "伺服器網址",
    ollamaUrlDesc: "Embedding 伺服器位址",
    apiFormat: "API 格式",
    apiFormatDesc: "Ollama 用於 Ollama；OpenAI-compatible 用於 llama.cpp、LM Studio、MLX、vLLM、OpenAI 等",
    apiFormatOllama: "Ollama",
    apiFormatOpenAI: "OpenAI-compatible",
    embeddingModel: "Embedding 模型",
    embeddingModelDesc: "模型名稱（例如 qwen3-embedding:0.6b、nomic-embed-text、text-embedding-3-small）",
    topResults: "顯示筆數",
    topResultsDesc: "搜尋和 Discover 最多顯示幾筆結果",
    minScore: "最低分數",
    minScoreDesc: "低於此門檻的結果不顯示（0.0 – 1.0）。越低結果越多，越高越嚴格。",
    maxEmbedChars: "最大 Embed 字數",
    maxEmbedCharsDesc: "每篇筆記取前幾個字做 embedding。有 description 的筆記會優先用 description。修改後需重建索引。",
    hotDays: "Hot 天數",
    hotDaysDesc: "近幾天內建立或編輯過的筆記視為 Hot（活躍）：任何編輯都算主動判定，只是打開筆記不算。Hot 筆記有連結或近期活動；Cold 筆記是孤立的，會被 Discover 發掘出來。修改即時生效，不需重建索引。",
    searchScope: "預設搜尋範圍",
    searchScopeDesc: "Hot = 有連結或近期的筆記。Cold = 孤立筆記（適合重新發現）。全部 = 不篩選。",
    scopeHot: "僅 Hot",
    scopeAll: "全部",
    excludePatterns: "排除路徑",
    excludePatternsDesc: "不索引也不 Discover 的資料夾前綴（每行一個，例如 3_wiki/）",
    autoIndex: "自動更新索引",
    autoIndexDesc: "筆記修改時自動重新 embed，保持 Discover 結果即時。",
    chunkSize: "Chunk 大小",
    chunkSizeDesc: "每個 chunk 的字數（修改後需重建索引）",
    chunkOverlap: "Chunk 重疊",
    chunkOverlapDesc: "相鄰 chunk 重疊的字數",
    synonymsLabel: "同義詞",
    synonymsDesc: "每行一組：關鍵字 = 同義詞1, 同義詞2",
    llmModel: "LLM 模型",
    llmModelDesc: "AI 整理（description / MOC 群組命名）使用的 LLM 模型。Ollama 推薦：qwen3:1.7b；OpenAI-compatible 可用 gpt-4o-mini 等。",
    enableAICuration: "啟用 AI 整理",
    enableAICurationDesc: "開啟後才會出現 Description 生成與主題分群 MOC 等指令。LLM 沿用上方 Embedding 提供者的 endpoint（Ollama 或 OpenAI-compatible）。",
    llmEndpointHeading: "LLM 連線狀態",
    llmEndpointProbing: "檢測中…",
    llmEndpointReachable: "✓ 可連線",
    llmEndpointUnreachable: (reason: string) => `⚠ 無法連線：${reason}`,
    llmEndpointHint: "請啟動 Ollama（ollama.com），或將上方「Embedding 提供者」切換為 OpenAI-compatible。",
    llmEndpointRecheck: "重新檢測",
    actions: "操作",
    rebuildIndex: "重建索引",
    rebuildIndexDesc: "全部重新 embed。大量新增檔案或更換 embedding 模型後需要執行。",
    rebuildBtn: "重建",
    indexingBtn: "建立中...",
    updateIndex: "更新索引",
    updateIndexDesc: "只 embed 新增或修改的筆記，比全部重建快。",
    updateBtn: "更新",
    updatingBtn: "更新中...",
    indexStats: "索引統計",
    totalNotes: "筆記總數",
    hot: "Hot",
    cold: "Cold",
    model: "模型",
    dimensions: "向量維度",
    lastIndexed: "上次索引",
    searchPlaceholder: "語意搜尋...",
    searchResults: (n) => `${n} 筆結果`,
    indexEmpty: "索引為空，請先執行「重建索引」",
    searchFailed: "搜尋失敗",
    searching: "搜尋中...",
    cmdSemanticSearch: "語意搜尋（彈窗）",
    cmdOpenPanel: "開啟搜尋面板",
    cmdFindSimilar: "尋找相似筆記",
    cmdRebuild: "重建索引",
    cmdUpdate: "更新索引",
    cmdDescActive: "為當前筆記生成 description",
    cmdDescSelected: "為目前結果生成 description",
    menuDescGenerate: "VC: 生成 description",
    menuFindSimilar: "VC: 尋找相似筆記",
    btnDescGenerate: "生成 description",
    ollamaNotReady: "無法連線 Ollama，請確認 Ollama 已啟動",
    noSimilar: "找不到相似筆記",
    notIndexed: "此筆記尚未索引",
    similarTo: (title) => `與「${title}」相似`,
    descNoLlmConfigured: "尚未設定 LLM，請先在設定中指定 LLM 模型。",
    descGenerating: (done, total) => `生成 description：${done}/${total}...`,
    descGeneratingOne: (name) => `正在為 ${name} 生成 description…`,
    descGeneratedOne: (name) => `已為 ${name} 寫入 description`,
    descBatchDone: (ok, failed) => failed > 0
        ? `完成 — ${ok} 篇成功、${failed} 篇失敗`
        : `完成 — ${ok} 篇`,
    descLlmFailed: (name) => `LLM 對 ${name} 生成失敗`,
    descNoEligible: "目前結果中沒有缺少 description 的筆記。",
    descAICurationOff: "AI 整理尚未啟用。請到設定開啟後再使用此指令。",
    descOpenSidebarFirst: "請先開啟 Vault Curate 面板並執行搜尋。",
    apiKeyLabel: "API key",
    apiKeyDesc: "選填 — 用於需要認證的伺服器",
    urlPlaceholder: "http://localhost:11434",
    apiKeyPlaceholder: "sk-...",
    remoteWarning: "\u26a0 遠端伺服器 — 筆記內容將傳送至外部機器",
    httpApiKeyWarning: "\u26a0 API key 將以明文透過 HTTP 傳送，建議改用 HTTPS。",
    selectModel: "選擇模型",
    tabSearch: "搜尋",
    tabDiscover: "發掘",
    discoverCurrentNote: "當前筆記",
    discoverGlobal: "全域",
    discoverRelatedTo: (title) => `相關於：${title}`,
    discoverEmpty: "找不到相關筆記",
    discoverNoIndex: "請先建立索引",
    discoverComputing: "計算中...",
    discoverGlobalDesc: "與你目前思路最相關但尚未探索的筆記",
    discoverProgress: (done, total) => `計算中：${done}/${total}...`,
    generateMoc: "生成 MOC",
    mocCreated: (path) => `MOC 已建立：${path}`,
    mocNoResults: "沒有結果可生成 MOC",
    cmdGlobalDiscover: "發掘相關的 Cold 筆記",
    scopeCold: "僅 Cold",
    sectionQuickSetup: "快速設定",
    sectionAICuration: "AI 整理",
    sectionAdvanced: "進階",
    embeddingProvider: "Embedding 提供者",
    embeddingProviderDesc: "Embedding 在哪裡計算。\n• 內建：完全在裝置上跑，內容不出網路。\n• Ollama：本機跑的 daemon（127.0.0.1）—— 同樣不出網路。\n• OpenAI-compatible：相容 endpoint，可能是本機（LM Studio、llama.cpp 等）也可能是遠端 API（OpenAI 等）—— 筆記內容可能被送到外部伺服器。",
    embeddingProviderBuiltin: "內建（裝置端、WebGPU）",
    embeddingProviderOllama: "Ollama（本機 daemon）",
    embeddingProviderOpenAI: "OpenAI-compatible API（本機或遠端）",
    builtinModelNote: "模型：bge-small-zh-v1.5（~33M 參數，首次執行下載 ~110MB），WebGPU 加速。",
    providerSwitchTitle: "切換 Embedding 提供者？",
    providerSwitchBody: (notes) =>
        `這會清空現有索引並重新索引整個 vault。約 ${notes} 篇筆記需重新 embed，預估 1–10 分鐘（視提供者而定）。`,
    providerSwitchConfirm: "確認並重新索引",
    providerSwitchCancel: "取消",
    onboardingTitle: "歡迎使用 Vault Curate",
    onboardingIntro: "Vault Curate 為 Obsidian 提供高品質的中文語意搜尋。請選擇 embedding 運行位置。",
    onboardingProviderHeading: "Embedding 提供者",
    onboardingOllamaDetected: "✓ 偵測到 Ollama（localhost:11434）",
    onboardingOllamaNotDetected: "⚠ 未偵測到 Ollama。請從 ollama.com 安裝後重開此視窗。",
    onboardingOpenaiEndpoint: "Endpoint URL",
    onboardingOpenaiModel: "模型名稱",
    onboardingTestConnection: "測試連線",
    onboardingTestOk: "✓ 可連線",
    onboardingTestFail: "✗ 無法連線",
    onboardingAIHeading: "啟用 AI 整理？",
    onboardingAIYes: "啟用 — Description 生成與主題分群 MOC",
    onboardingAINo: "不用，純搜尋",
    onboardingAIRequiresLlm: "AI 整理需要 LLM endpoint。請先啟動 Ollama（ollama.com）或把 embedding 切換為 OpenAI-compatible。",
    onboardingIndexNow: "現在開始建立索引",
    onboardingLater: "稍後再說",
    backendNotReady: "後端未就緒 — 請重新載入 plugin（檢查 console 看初始化錯誤）。",
    rerunOnboarding: "重新執行 Onboarding",
    rerunOnboardingDesc: "重新打開首次啟動設定視窗 — 若之前 dismiss 了想重新選 provider / AI 整理，可從這裡進。",
    rerunOnboardingBtn: "開啟 Onboarding",
    dimMismatchNotice: (skipped) =>
        `${skipped} 篇筆記的 embedding 維度與當前模型不符。請執行「重建索引」修復。`,
    noticeIndexEmpty: "Vault Curate：索引為空，請先執行「重建索引」",
    noticeIndexing: (done, total) => `Vault Curate：索引中 ${done}/${total}...`,
    noticeDescBackfill: (total) => `Vault Curate：補嵌 ${total} 篇 description（升級一次性作業，約 1-3 分鐘）...`,
    noticeDescBackfillDone: (written) => `Vault Curate：description 向量就緒（${written} 篇）`,
    noticeBuildingSearchIndex: "Vault Curate：建置關鍵字索引中...",
    noticeIndexDone: (total, hot, cold, failed) => {
        const f = failed > 0 ? `，${failed} 篇失敗` : "";
        return `Vault Curate：完成 — ${total} 篇（${hot} hot、${cold} cold${f}）`;
    },
    noticeUpToDate: "Vault Curate：索引已是最新",
    noticeUpdated: (updated, total, hot) =>
        `Vault Curate：已更新 ${updated} 篇（共 ${total} 篇，${hot} hot）`,
    noticeEmptySkipped: (n) => `Vault Curate：略過 ${n} 篇空白筆記（無內容可索引）`,
    noticeLargeVault: (chunks) =>
        `Vault Curate：完成 ${chunks} 個 chunks 索引。語意搜尋可能需要數秒；若感到慢，可至「設定 → 進階 → 搜尋範圍」改為 Hot only。`,
    discoverGlobalNoHot: "目前沒有 Hot 筆記 — 加入 internal link 或近期建立筆記後 Hot 池子會浮現，才能用發掘找相關的 Cold 筆記。",
    discoverGlobalNoCold: "目前沒有 Cold 筆記 — vault 中所有筆記都有連結或近期建立，沒有可重新發現的內容。",
    discoverGlobalAllFiltered: "所有 Cold 候選筆記分數低於最低門檻 — 請至「設定 → 進階 → 最低分數」調低後重試。",
    discoverPin: "釘選",
    discoverUnpin: "解除釘選",
    discoverPinnedTo: (title) => `已釘選：${title}`,
    discoverPinNoFile: "請先打開筆記，再釘選 Discover。",
    discoverPinFileGone: "已釘選筆記被刪除 — Discover 解除釘選。",
    cmdGenerateGraph: "生成關聯圖（Canvas）",
    menuGenerateGraph: "VC: 生成關聯圖",
    discoverGraphBtn: "關聯圖",
    discoverGraphNoFile: "請先打開筆記，再生成關聯圖。",
    noticeGraphNoResults: "Vault Curate：沒有超過相似度門檻的筆記，未建立關聯圖。可到進階設定調低「最低分數」放寬條件。",
    noticeGraphCreated: (path) => `Vault Curate：關聯圖已建立 — ${path}`,
    cmdSemanticPath: "生成語意路徑（Canvas）",
    menuSemanticPath: "VC: 生成語意路徑",
    pathModalPlaceholder: "選擇終點筆記…",
    pathFilePrefix: "語意路徑",
    noticePathBuilding: (n, estSeconds) => `Vault Curate：正在對 ${n} 篇筆記建立語意圖…${estSeconds ? `（首次建圖約 ${estSeconds} 秒，之後同索引免重算）` : ""}`,
    noticePathNotConnected: (k, hops) => `Vault Curate：${hops} 跳內在 K=${k} 鄰域不連通——兩篇筆記語意距離遠（這是有價值的資訊，不是錯誤）。`,
    noticePathWeak: (bottleneck, threshold) => `Vault Curate：最強鏈的瓶頸僅 ${bottleneck.toFixed(3)}，低於本圖門檻 ${threshold.toFixed(3)}——不存在全程夠強的關聯鏈，視為語意不連通。`,
    noticePathSameNote: "Vault Curate：起點與終點是同一篇筆記，請選擇不同筆記。",
    noticePathCreated: (path) => `Vault Curate：語意路徑已建立 — ${path}`,
    noticePathCreateFailed: "Vault Curate：路徑 canvas 寫入失敗，詳見 console。",
    menuExpandInCanvas: "VC: 在此圖展開",
    noticeExpandAdded: (added, linked) => {
        const parts: string[] = [];
        if (added > 0) parts.push(`展開 ${added} 篇相關筆記`);
        if (linked > 0) parts.push(`補上 ${linked} 條與圖上既有筆記的關聯`);
        return `Vault Curate：已${parts.join("，並")}`;
    },
    noticeExpandNothingNew: "Vault Curate：沒有可新增的筆記——相似筆記均已在圖上（或無超過門檻的結果）。",
    noticeExpandCrowded: (n) => `Vault Curate：圖上已有 ${n} 個節點，建議另開新圖保持可讀性。`,
    noticeExpandCollision: "Vault Curate：空間擁擠，部分新節點可能重疊，請手動整理。",
    noticeExpandFailed: "Vault Curate：無法解析此 canvas 檔，未做任何變更。",
    settingCanvasFolder: "關聯圖資料夾",
    settingCanvasFolderDesc: "生成的 .canvas 檔存放位置。留空 = vault 根目錄。若指到被同步工具排除的資料夾，生成的圖不會同步，請自行留意。",
    menuPromote: "VC: 套用紫邊為 wikilink",
    cmdPromote: "套用紫邊為 wikilink",
    noticePromoteWriting: (pairs: number) =>
        `Vault Curate：正在寫入 ${pairs} 對連結…`,
    promoteTitle: "紫邊升級為 wikilink",
    promoteHint: "勾選的筆記會與該組來源筆記建立真正的 wikilink（依「雙向寫入」設定寫進兩篇、或僅來源筆記的相關筆記小節），該邊改為灰色。未勾選的不會有任何寫入。Cmd/Ctrl+滑過筆記名可預覽內容。",
    promoteApply: "套用",
    promoteCancel: "取消",
    promoteSelectedCount: (n: number) => `已選 ${n} 對`,
    noticePromoteEmpty: "Vault Curate：此圖沒有可升級的紫邊。",
    noticePromoteInvalidCanvas: "Vault Curate：無法讀取此 canvas 檔案。",
    noticePromoteDone: (links: number, edges: number) =>
        `Vault Curate：已寫入 ${links} 條 wikilink，更新 ${edges} 條邊。`,
    noticePromoteSkipped: (pairs: number) =>
        `Vault Curate：已跳過 ${pairs} 對（圖在對話框開啟期間被修改）。`,
    noticePromotePartial: (n: number) =>
        `Vault Curate：${n} 筆寫入失敗，詳見開發者 console。`,
    noticePromoteCanvasFailed: "Vault Curate：連結已寫入，但圖更新失敗；下次執行升級掃描時會自動校正。",
    relatedSectionDefault: "## 相關筆記",
    settingRelatedSection: "相關筆記小節標題",
    settingRelatedSectionDesc: "升級的 wikilink 會寫在這個標題底下（筆記沒有此節時自動在檔尾新建）。留空 = 隨介面語言。",
    settingPromoteBidirectional: "雙向寫入",
    settingPromoteBidirectionalDesc: "升級時把 wikilink 同時寫進兩篇筆記。關閉後只寫入邊的來源筆記。",
    noticeIndexCorrupt: "Vault Curate：索引檔案已損壞，請重建索引。",
    indexingInProgress: "Vault Curate：正在索引中，請稍候",
    viewDisplayName: "語意搜尋",
    mocTitleSearch: (query) => `MOC：${query}`,
    mocDescSearch: (query) => `「${query}」的搜尋結果`,
    mocTitleRelated: (title) => `MOC：${title}`,
    mocDescRelated: (title) => `與「${title}」相關的筆記`,
    mocTitleGlobal: "MOC：全域發掘",
    mocDescGlobal: "與現有熱門筆記最相關的冷門筆記",
    instructNav: "瀏覽",
    instructOpen: "開啟筆記",
    instructDismiss: "關閉",
    languageLabel: "繁體中文",
    cmdGenerateMocGrouped: "生成 MOC（主題分群）",
    mocGroupedDescription: (query) => `主題分群的 MOC，來自查詢：${query}`,
    mocMiscellaneous: "其他",
    mocMiscIntro: "與查詢相關但未歸入上述群組的筆記。",
    mocClusteringStatus: (current, total) => `正在分群 ${current}/${total} 筆筆記…`,
    mocNamingStatus: (current, total) => `正在命名群組 ${current}/${total}…`,
    mocTooFewResults: "結果少於 5 筆，改產生平面 MOC",
    mocClusteringDegenerate: "結果主題過於相近，改產生平面 MOC",
    mocTooManyResults: (n) => `結果過多（${n} 筆），請先用標籤或資料夾過濾`,
    mocConfirmLarge: (n, seconds) => `${n} 筆筆記需約 ${seconds} 秒組織，是否繼續？`,
    mocFallbackGroup: (n) => `群組 ${n}`,
    mocCanceled: "MOC 生成已取消，已儲存部分結果。",
    mocLlmUnavailable: "LLM 無法使用，群組已儲存但未命名",
    mocClusterNamingPrompt: (languageLabel, notesBlock) => `你正在整理一個知識庫。以下筆記因為討論相關主題而被分為一群。根據共同主題，產出：

- title：精煉標題（3-8 個${languageLabel}字）
- intro：1-2 句介紹（40-80 字），描述這群筆記的共通主題

筆記：
${notesBlock}

只回覆有效的 JSON（使用${languageLabel}）：
{"title": "...", "intro": "..."}`,
    llmPrompt: (title, content) => `任務：為筆記產生 description 和 tags。

規則：
1. description 必須使用繁體中文，50-100 字，禁止用英文或簡體中文
2. description 必須描述具體內容，禁止重複標題
3. 只描述筆記的內容主題，禁止描述筆記的格式或結構（如表格、統計、圖表、欄位）
4. tags 必須使用繁體中文，3-5 個，不要 # 前綴，不能有空格
5. 只回覆 JSON，不要解釋

{"description": "...", "tags": ["...", "...", "..."]}

筆記標題：${title}

筆記內容：
${content}`,
};

const locales: Record<string, Locale> = { en, "zh-TW": zhTW };

export function getLocale(): Locale {
    // Use moment locale set by Obsidian (avoids direct localStorage access)
    const lang = window.moment?.locale?.() ?? "en";
    if (lang.startsWith("zh")) return zhTW;
    return locales[lang] ?? en;
}

export const t = getLocale();
