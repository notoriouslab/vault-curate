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
    /** 015: semantic leg failed mid-query; results are keyword-only. */
    semanticDegraded: string;
    /** 015 mobile: index loading takes a while (first iCloud download). */
    noticeMobileIndexLoading: string;
    /** 015 mobile: index refused — exceeds the mobile size guard. */
    mobileIndexTooLarge: (mb: number) => string;
    /** 015 mobile: index failed to open; retry hint. */
    mobileIndexLoadFailed: string;
    /** 015 mobile: reload-index button (settings card + retry affordance). */
    mobileReloadIndex: string;
    /** 015 mobile: empty state — no index yet (desktop builds it). */
    mobileNoIndexYet: string;
    /** 015 mobile: settings card explainer — desktop owns the index. */
    mobileIndexMaintainedByDesktop: string;
    /** 015 mobile: loopback endpoint can't be reached from a phone. */
    mobileLoopbackWarning: string;
    /** 017: search-tab button — export current results as a canvas. */
    exportResultsCanvas: string;
    /** 017: results canvas written. */
    noticeResultsCanvasCreated: (path: string) => string;
    /** 017: readability cap kicked in — shown/total. */
    noticeResultsCanvasTruncated: (shown: number, total: number) => string;
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
    dismissTooltip: string;
    dismissedNotice: string;
    dismissedHeading: string;
    dismissedManageDesc: (n: number) => string;
    dismissedManage: string;
    dismissedRestore: string;
    dismissedEmpty: string;
    dismissedPairsSection: string;
    dismissedNotesSection: string;
    dismissedOpenTooltip: string;
    dismissedCopyTooltip: string;
    dismissedCopied: string;
    dismissedFileMissing: string;
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
    discoverGlobalNoProfile: string;
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
    noticePathProgress: (n: number, percent: number) => string;
    noticePathCancel: string;
    noticePathCancelled: string;
    noticePathFallback: string;
    noticePathFallbackBuilding: string;
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
    promoteDismiss: string;
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
    instructOpenTab: string;
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
    semanticDegraded: "Semantic search temporarily unavailable — showing keyword results",
    noticeMobileIndexLoading: "Vault Curate: loading index (first load may need to download it)...",
    mobileIndexTooLarge: (mb) => `Vault Curate: index too large for mobile (${mb} MB) — search stays desktop-only for this vault`,
    mobileIndexLoadFailed: "Index failed to load — if the vault just synced, retry in a moment",
    mobileReloadIndex: "Reload index",
    mobileNoIndexYet: "No index yet — open Vault Curate on your desktop once to build it; the index then syncs to this device with your vault",
    mobileIndexMaintainedByDesktop: "The index is built and maintained on desktop; this device reads it (read-only).",
    mobileLoopbackWarning: "⚠ localhost is not reachable from this device — search runs in keyword mode",
    exportResultsCanvas: "Export results to Canvas",
    noticeResultsCanvasCreated: (path) => `Vault Curate: results canvas created — ${path}`,
    noticeResultsCanvasTruncated: (shown, total) => `Vault Curate: exported the top ${shown} of ${total} results (canvas readability cap)`,
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
    dismissTooltip: "Don't suggest this again",
    dismissedNotice: "Suggestion hidden. Restore it under Settings → Hidden suggestions.",
    dismissedHeading: "Hidden suggestions",
    dismissedManageDesc: (n) => `${n} hidden. Hidden pairs and notes never appear in suggestions again until restored.`,
    dismissedManage: "Manage",
    dismissedRestore: "Restore",
    dismissedEmpty: "Nothing hidden yet. Use the ✕ on a suggestion to hide it.",
    dismissedPairsSection: "Hidden pairs",
    dismissedNotesSection: "Hidden notes (global discover)",
    dismissedOpenTooltip: "Open note",
    dismissedCopyTooltip: "Copy path",
    dismissedCopied: "Path copied to clipboard.",
    dismissedFileMissing: "Note not found — it may have been renamed or deleted. Use the copy button to search manually.",
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
    discoverGlobalDesc: "Forgotten notes most related to your recent focus, grouped by folder",
    discoverGlobalNoProfile: "No recent activity to build a focus profile from — edit or create a few notes first.",
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
    noticePathProgress: (n, percent) => `Vault Curate: Building semantic graph over ${n} notes… ${percent}%`,
    noticePathCancel: "Cancel",
    noticePathCancelled: "Vault Curate: Graph build cancelled.",
    noticePathFallback: "Vault Curate: Background build unavailable — built on the main thread instead.",
    noticePathFallbackBuilding: "Vault Curate: Background build unavailable — building on the main thread (UI may pause)…",
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
    promoteDismiss: "Don't suggest",
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
    instructOpenTab: "open in new tab",
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
    semanticDegraded: "語意搜尋暫時不可用，以下為關鍵字結果",
    noticeMobileIndexLoading: "Vault Curate：索引載入中（首次可能需要下載）...",
    mobileIndexTooLarge: (mb) => `Vault Curate：索引過大（${mb} MB），手機端暫不載入`,
    mobileIndexLoadFailed: "索引載入失敗：若 vault 剛同步完成，請稍後重試",
    mobileReloadIndex: "重新載入索引",
    mobileNoIndexYet: "尚無索引：請先在桌機開啟一次 Vault Curate 完成建索引，索引會隨 vault 同步到這台裝置",
    mobileIndexMaintainedByDesktop: "索引由桌機建立與維護，這台裝置以唯讀方式使用。",
    mobileLoopbackWarning: "⚠ localhost 在這台裝置上不可達，語意搜尋將以關鍵字模式運作",
    exportResultsCanvas: "結果導出 Canvas",
    noticeResultsCanvasCreated: (path) => `Vault Curate：結果 Canvas 已建立 — ${path}`,
    noticeResultsCanvasTruncated: (shown, total) => `Vault Curate：已導出前 ${shown} 篇（共 ${total} 篇，Canvas 可讀性上限）`,
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
    dismissTooltip: "不再建議這個配對",
    dismissedNotice: "已隱藏這個建議，可在設定的「已隱藏的建議」中恢復。",
    dismissedHeading: "已隱藏的建議",
    dismissedManageDesc: (n) => `已隱藏 ${n} 筆。被隱藏的配對與筆記不會再出現在建議中，恢復後才會重新出現。`,
    dismissedManage: "管理",
    dismissedRestore: "恢復",
    dismissedEmpty: "還沒有隱藏任何建議。在建議結果上按 ✕ 即可隱藏。",
    dismissedPairsSection: "已隱藏的配對",
    dismissedNotesSection: "已隱藏的筆記（全域發掘）",
    dismissedOpenTooltip: "開啟筆記",
    dismissedCopyTooltip: "複製路徑",
    dismissedCopied: "已複製路徑。",
    dismissedFileMissing: "找不到這篇筆記，可能已改名或刪除。可用複製按鈕取得路徑後手動搜尋。",
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
    discoverGlobalDesc: "與你近期關注最相關、但已被遺忘的筆記（依資料夾分組）",
    discoverGlobalNoProfile: "近期沒有活動筆記可構成關注剖繪，先編輯或建立幾篇筆記吧。",
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
    noticePathProgress: (n, percent) => `Vault Curate：正在對 ${n} 篇筆記建立語意圖… ${percent}%`,
    noticePathCancel: "取消",
    noticePathCancelled: "Vault Curate：已取消建圖。",
    noticePathFallback: "Vault Curate：背景建圖不可用，已改在主執行緒建圖。",
    noticePathFallbackBuilding: "Vault Curate：背景建圖不可用，改在主執行緒建圖中（介面可能短暫停頓）…",
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
    promoteDismiss: "不再建議",
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
    instructOpenTab: "新分頁開啟",
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

// 简体中文（大陆用语）。与 zhTW 的差异不止字形：IT 用词按大陆习惯本地化
// （伺服器→服务器、資料夾→文件夹、搜尋→搜索、預設→默认、語意→语义 等），
// LLM 生成 description / MOC 命名也要求输出简体。
const zhCN: Locale = {
    ollamaUrl: "服务器地址",
    ollamaUrlDesc: "Embedding 服务器地址",
    apiFormat: "API 格式",
    apiFormatDesc: "Ollama 用于 Ollama；OpenAI-compatible 用于 llama.cpp、LM Studio、MLX、vLLM、OpenAI 等",
    apiFormatOllama: "Ollama",
    apiFormatOpenAI: "OpenAI-compatible",
    embeddingModel: "Embedding 模型",
    embeddingModelDesc: "模型名称（例如 qwen3-embedding:0.6b、nomic-embed-text、text-embedding-3-small）",
    topResults: "显示条数",
    topResultsDesc: "搜索和 Discover 最多显示几条结果",
    minScore: "最低分数",
    minScoreDesc: "低于此阈值的结果不显示（0.0 – 1.0）。越低结果越多，越高越严格。",
    maxEmbedChars: "最大 Embed 字数",
    maxEmbedCharsDesc: "每篇笔记取前多少字做 embedding。有 description 的笔记会优先用 description。修改后需重建索引。",
    hotDays: "Hot 天数",
    hotDaysDesc: "近多少天内创建或编辑过的笔记视为 Hot（活跃）：任何编辑都算主动操作，只是打开笔记不算。Hot 笔记有链接或近期活动；Cold 笔记是孤立的，会被 Discover 发掘出来。修改即时生效，无需重建索引。",
    searchScope: "默认搜索范围",
    searchScopeDesc: "Hot = 有链接或近期的笔记。Cold = 孤立笔记（适合重新发现）。全部 = 不筛选。",
    scopeHot: "仅 Hot",
    scopeAll: "全部",
    excludePatterns: "排除路径",
    excludePatternsDesc: "不索引也不 Discover 的文件夹前缀（每行一个，例如 3_wiki/）",
    autoIndex: "自动更新索引",
    autoIndexDesc: "笔记修改时自动重新 embed，保持 Discover 结果即时。",
    chunkSize: "Chunk 大小",
    chunkSizeDesc: "每个 chunk 的字数（修改后需重建索引）",
    chunkOverlap: "Chunk 重叠",
    chunkOverlapDesc: "相邻 chunk 重叠的字数",
    synonymsLabel: "同义词",
    synonymsDesc: "每行一组：关键词 = 同义词1, 同义词2",
    llmModel: "LLM 模型",
    llmModelDesc: "AI 整理（description / MOC 分组命名）使用的 LLM 模型。Ollama 推荐：qwen3:1.7b；OpenAI-compatible 可用 gpt-4o-mini 等。",
    enableAICuration: "启用 AI 整理",
    enableAICurationDesc: "开启后才会出现 Description 生成与主题分组 MOC 等命令。LLM 沿用上方 Embedding 提供者的 endpoint（Ollama 或 OpenAI-compatible）。",
    llmEndpointHeading: "LLM 连接状态",
    llmEndpointProbing: "检测中…",
    llmEndpointReachable: "✓ 可连接",
    llmEndpointUnreachable: (reason: string) => `⚠ 无法连接：${reason}`,
    llmEndpointHint: "请启动 Ollama（ollama.com），或将上方「Embedding 提供者」切换为 OpenAI-compatible。",
    llmEndpointRecheck: "重新检测",
    actions: "操作",
    rebuildIndex: "重建索引",
    rebuildIndexDesc: "全部重新 embed。大量新增文件或更换 embedding 模型后需要执行。",
    rebuildBtn: "重建",
    indexingBtn: "建立中...",
    updateIndex: "更新索引",
    updateIndexDesc: "只 embed 新增或修改的笔记，比全部重建快。",
    updateBtn: "更新",
    updatingBtn: "更新中...",
    indexStats: "索引统计",
    totalNotes: "笔记总数",
    hot: "Hot",
    cold: "Cold",
    model: "模型",
    dimensions: "向量维度",
    lastIndexed: "上次索引",
    searchPlaceholder: "语义搜索...",
    searchResults: (n) => `${n} 条结果`,
    indexEmpty: "索引为空，请先执行「重建索引」",
    searchFailed: "搜索失败",
    semanticDegraded: "语义搜索暂时不可用，以下为关键字结果",
    noticeMobileIndexLoading: "Vault Curate：索引加载中（首次可能需要下载）...",
    mobileIndexTooLarge: (mb) => `Vault Curate：索引过大（${mb} MB），手机端暂不加载`,
    mobileIndexLoadFailed: "索引加载失败：若 vault 刚同步完成，请稍后重试",
    mobileReloadIndex: "重新加载索引",
    mobileNoIndexYet: "尚无索引：请先在桌面端打开一次 Vault Curate 完成建索引，索引会随 vault 同步到这台设备",
    mobileIndexMaintainedByDesktop: "索引由桌面端建立与维护，这台设备以只读方式使用。",
    mobileLoopbackWarning: "⚠ localhost 在这台设备上不可达，语义搜索将以关键字模式运作",
    exportResultsCanvas: "结果导出 Canvas",
    noticeResultsCanvasCreated: (path) => `Vault Curate：结果 Canvas 已创建 — ${path}`,
    noticeResultsCanvasTruncated: (shown, total) => `Vault Curate：已导出前 ${shown} 篇（共 ${total} 篇，Canvas 可读性上限）`,
    searching: "搜索中...",
    cmdSemanticSearch: "语义搜索（弹窗）",
    cmdOpenPanel: "打开搜索面板",
    cmdFindSimilar: "查找相似笔记",
    cmdRebuild: "重建索引",
    cmdUpdate: "更新索引",
    cmdDescActive: "为当前笔记生成 description",
    cmdDescSelected: "为当前结果生成 description",
    menuDescGenerate: "VC: 生成 description",
    menuFindSimilar: "VC: 查找相似笔记",
    btnDescGenerate: "生成 description",
    ollamaNotReady: "无法连接 Ollama，请确认 Ollama 已启动",
    noSimilar: "找不到相似笔记",
    notIndexed: "此笔记尚未索引",
    similarTo: (title) => `与「${title}」相似`,
    dismissTooltip: "不再建议这个组合",
    dismissedNotice: "已隐藏这条建议，可在设置的「已隐藏的建议」中恢复。",
    dismissedHeading: "已隐藏的建议",
    dismissedManageDesc: (n) => `已隐藏 ${n} 条。被隐藏的组合与笔记不会再出现在建议中，恢复后才会重新出现。`,
    dismissedManage: "管理",
    dismissedRestore: "恢复",
    dismissedEmpty: "还没有隐藏任何建议。在建议结果上按 ✕ 即可隐藏。",
    dismissedPairsSection: "已隐藏的组合",
    dismissedNotesSection: "已隐藏的笔记（全局发掘）",
    dismissedOpenTooltip: "打开笔记",
    dismissedCopyTooltip: "复制路径",
    dismissedCopied: "已复制路径。",
    dismissedFileMissing: "找不到这篇笔记，可能已改名或删除。可用复制按钮获取路径后手动搜索。",
    descNoLlmConfigured: "尚未设置 LLM，请先在设置中指定 LLM 模型。",
    descGenerating: (done, total) => `生成 description：${done}/${total}...`,
    descGeneratingOne: (name) => `正在为 ${name} 生成 description…`,
    descGeneratedOne: (name) => `已为 ${name} 写入 description`,
    descBatchDone: (ok, failed) => failed > 0
        ? `完成 — ${ok} 篇成功、${failed} 篇失败`
        : `完成 — ${ok} 篇`,
    descLlmFailed: (name) => `${name} 的 description 生成失败`,
    descNoEligible: "当前结果中没有缺少 description 的笔记。",
    descAICurationOff: "AI 整理尚未启用。请到设置开启后再使用此命令。",
    descOpenSidebarFirst: "请先打开 Vault Curate 面板并执行搜索。",
    apiKeyLabel: "API key",
    apiKeyDesc: "选填 — 用于需要认证的服务器",
    urlPlaceholder: "http://localhost:11434",
    apiKeyPlaceholder: "sk-...",
    remoteWarning: "⚠ 远程服务器 — 笔记内容将发送到外部设备",
    httpApiKeyWarning: "⚠ API key 将以明文通过 HTTP 发送，建议改用 HTTPS。",
    selectModel: "选择模型",
    tabSearch: "搜索",
    tabDiscover: "发掘",
    discoverCurrentNote: "当前笔记",
    discoverGlobal: "全局",
    discoverRelatedTo: (title) => `相关于：${title}`,
    discoverEmpty: "找不到相关笔记",
    discoverNoIndex: "请先建立索引",
    discoverComputing: "计算中...",
    discoverGlobalDesc: "与你近期关注最相关、但已被遗忘的笔记（按文件夹分组）",
    discoverGlobalNoProfile: "近期没有活动笔记可构成关注画像，先编辑或创建几篇笔记吧。",
    discoverProgress: (done, total) => `计算中：${done}/${total}...`,
    generateMoc: "生成 MOC",
    mocCreated: (path) => `MOC 已创建：${path}`,
    mocNoResults: "没有结果可生成 MOC",
    cmdGlobalDiscover: "发掘相关的 Cold 笔记",
    scopeCold: "仅 Cold",
    sectionQuickSetup: "快速设置",
    sectionAICuration: "AI 整理",
    sectionAdvanced: "高级",
    embeddingProvider: "Embedding 提供者",
    embeddingProviderDesc: "Embedding 在哪里计算。\n• 内置：完全在设备上运行，内容不出网络。\n• Ollama：本机运行的 daemon（127.0.0.1）—— 同样不出网络。\n• OpenAI-compatible：兼容 endpoint，可能是本机（LM Studio、llama.cpp 等）也可能是远程 API（OpenAI 等）—— 笔记内容可能被发送到外部服务器。",
    embeddingProviderBuiltin: "内置（设备端、WebGPU）",
    embeddingProviderOllama: "Ollama（本机 daemon）",
    embeddingProviderOpenAI: "OpenAI-compatible API（本机或远程）",
    builtinModelNote: "模型：bge-small-zh-v1.5（~33M 参数，首次运行下载 ~110MB），WebGPU 加速。",
    providerSwitchTitle: "切换 Embedding 提供者？",
    providerSwitchBody: (notes) =>
        `这会清空现有索引并重新索引整个 vault。约 ${notes} 篇笔记需要重新 embed，预计 1–10 分钟（视提供者而定）。`,
    providerSwitchConfirm: "确认并重新索引",
    providerSwitchCancel: "取消",
    onboardingTitle: "欢迎使用 Vault Curate",
    onboardingIntro: "Vault Curate 为 Obsidian 提供高质量的中文语义搜索。请选择 embedding 运行位置。",
    onboardingProviderHeading: "Embedding 提供者",
    onboardingOllamaDetected: "✓ 检测到 Ollama（localhost:11434）",
    onboardingOllamaNotDetected: "⚠ 未检测到 Ollama。请从 ollama.com 安装后重新打开此窗口。",
    onboardingOpenaiEndpoint: "Endpoint URL",
    onboardingOpenaiModel: "模型名称",
    onboardingTestConnection: "测试连接",
    onboardingTestOk: "✓ 可连接",
    onboardingTestFail: "✗ 无法连接",
    onboardingAIHeading: "启用 AI 整理？",
    onboardingAIYes: "启用 — Description 生成与主题分组 MOC",
    onboardingAINo: "不用，仅搜索",
    onboardingAIRequiresLlm: "AI 整理需要 LLM endpoint。请先启动 Ollama（ollama.com）或把 embedding 切换为 OpenAI-compatible。",
    onboardingIndexNow: "现在开始建立索引",
    onboardingLater: "稍后再说",
    backendNotReady: "后端未就绪 — 请重新加载插件（查看 console 看初始化错误）。",
    rerunOnboarding: "重新执行 Onboarding",
    rerunOnboardingDesc: "重新打开首次启动设置窗口 — 如果之前关闭了想重新选 provider / AI 整理，可从这里进入。",
    rerunOnboardingBtn: "打开 Onboarding",
    dimMismatchNotice: (skipped) =>
        `${skipped} 篇笔记的 embedding 维度与当前模型不符。请执行「重建索引」修复。`,
    noticeIndexEmpty: "Vault Curate：索引为空，请先执行「重建索引」",
    noticeIndexing: (done, total) => `Vault Curate：索引中 ${done}/${total}...`,
    noticeDescBackfill: (total) => `Vault Curate：补嵌 ${total} 篇 description（升级一次性作业，约 1-3 分钟）...`,
    noticeDescBackfillDone: (written) => `Vault Curate：description 向量就绪（${written} 篇）`,
    noticeBuildingSearchIndex: "Vault Curate：正在建立关键词索引...",
    noticeIndexDone: (total, hot, cold, failed) => {
        const f = failed > 0 ? `，${failed} 篇失败` : "";
        return `Vault Curate：完成 — ${total} 篇（${hot} hot、${cold} cold${f}）`;
    },
    noticeUpToDate: "Vault Curate：索引已是最新",
    noticeUpdated: (updated, total, hot) =>
        `Vault Curate：已更新 ${updated} 篇（共 ${total} 篇，${hot} hot）`,
    noticeEmptySkipped: (n) => `Vault Curate：跳过 ${n} 篇空白笔记（无内容可索引）`,
    noticeLargeVault: (chunks) =>
        `Vault Curate：完成 ${chunks} 个 chunks 的索引。语义搜索可能需要几秒；如果觉得慢，可到「设置 → 高级 → 搜索范围」改为 Hot only。`,
    discoverGlobalNoCold: "目前没有 Cold 笔记 — vault 中所有笔记都有链接或近期创建，没有可重新发现的内容。",
    discoverGlobalAllFiltered: "所有 Cold 候选笔记的分数低于最低阈值 — 请到「设置 → 高级 → 最低分数」调低后重试。",
    discoverPin: "固定",
    discoverUnpin: "取消固定",
    discoverPinnedTo: (title) => `已固定：${title}`,
    discoverPinNoFile: "请先打开笔记，再固定 Discover。",
    discoverPinFileGone: "已固定的笔记被删除 — Discover 已取消固定。",
    cmdGenerateGraph: "生成关联图（Canvas）",
    menuGenerateGraph: "VC: 生成关联图",
    discoverGraphBtn: "关联图",
    discoverGraphNoFile: "请先打开笔记，再生成关联图。",
    noticeGraphNoResults: "Vault Curate：没有超过相似度阈值的笔记，未创建关联图。可到高级设置调低「最低分数」放宽条件。",
    noticeGraphCreated: (path) => `Vault Curate：关联图已创建 — ${path}`,
    cmdSemanticPath: "生成语义路径（Canvas）",
    menuSemanticPath: "VC: 生成语义路径",
    pathModalPlaceholder: "选择终点笔记…",
    pathFilePrefix: "语义路径",
    noticePathProgress: (n, percent) => `Vault Curate：正在对 ${n} 篇笔记建立语义图… ${percent}%`,
    noticePathCancel: "取消",
    noticePathCancelled: "Vault Curate：已取消建图。",
    noticePathFallback: "Vault Curate：后台建图不可用，已改在主线程建图。",
    noticePathFallbackBuilding: "Vault Curate：后台建图不可用，改在主线程建图中（界面可能短暂卡顿）…",
    noticePathNotConnected: (k, hops) => `Vault Curate：${hops} 跳内在 K=${k} 邻域不连通——两篇笔记语义距离远（这是有价值的信息，不是错误）。`,
    noticePathWeak: (bottleneck, threshold) => `Vault Curate：最强链路的瓶颈仅 ${bottleneck.toFixed(3)}，低于本图阈值 ${threshold.toFixed(3)}——不存在全程足够强的关联链，视为语义不连通。`,
    noticePathSameNote: "Vault Curate：起点与终点是同一篇笔记，请选择不同的笔记。",
    noticePathCreated: (path) => `Vault Curate：语义路径已创建 — ${path}`,
    noticePathCreateFailed: "Vault Curate：路径 canvas 写入失败，详见 console。",
    menuExpandInCanvas: "VC: 在此图中展开",
    noticeExpandAdded: (added, linked) => {
        const parts: string[] = [];
        if (added > 0) parts.push(`展开 ${added} 篇相关笔记`);
        if (linked > 0) parts.push(`补上 ${linked} 条与图中已有笔记的关联`);
        return `Vault Curate：已${parts.join("，并")}`;
    },
    noticeExpandNothingNew: "Vault Curate：没有可新增的笔记——相似笔记都已在图中（或没有超过阈值的结果）。",
    noticeExpandCrowded: (n) => `Vault Curate：图中已有 ${n} 个节点，建议另开新图保持可读性。`,
    noticeExpandCollision: "Vault Curate：空间拥挤，部分新节点可能重叠，请手动整理。",
    noticeExpandFailed: "Vault Curate：无法解析此 canvas 文件，未做任何更改。",
    settingCanvasFolder: "关联图文件夹",
    settingCanvasFolderDesc: "生成的 .canvas 文件存放位置。留空 = vault 根目录。如果指向被同步工具排除的文件夹，生成的图不会同步，请自行留意。",
    menuPromote: "VC: 将紫边应用为 wikilink",
    cmdPromote: "将紫边应用为 wikilink",
    noticePromoteWriting: (pairs: number) =>
        `Vault Curate：正在写入 ${pairs} 对链接…`,
    promoteTitle: "将紫边升级为 wikilink",
    promoteHint: "勾选的笔记会与该组来源笔记建立真正的 wikilink（按「双向写入」设置写进两篇、或仅来源笔记的相关笔记小节），该边改为灰色。未勾选的不会有任何写入。Cmd/Ctrl+悬停笔记名可预览内容。",
    promoteApply: "应用",
    promoteCancel: "取消",
    promoteDismiss: "不再建议",
    promoteSelectedCount: (n: number) => `已选 ${n} 对`,
    noticePromoteEmpty: "Vault Curate：此图没有可升级的紫边。",
    noticePromoteInvalidCanvas: "Vault Curate：无法读取此 canvas 文件。",
    noticePromoteDone: (links: number, edges: number) =>
        `Vault Curate：已写入 ${links} 条 wikilink，更新 ${edges} 条边。`,
    noticePromoteSkipped: (pairs: number) =>
        `Vault Curate：已跳过 ${pairs} 对（图在对话框打开期间被修改）。`,
    noticePromotePartial: (n: number) =>
        `Vault Curate：${n} 次写入失败，详见开发者 console。`,
    noticePromoteCanvasFailed: "Vault Curate：链接已写入，但图更新失败；下次执行升级扫描时会自动校正。",
    relatedSectionDefault: "## 相关笔记",
    settingRelatedSection: "相关笔记小节标题",
    settingRelatedSectionDesc: "升级的 wikilink 会写在这个标题下（笔记没有此节时自动在文末新建）。留空 = 跟随界面语言。",
    settingPromoteBidirectional: "双向写入",
    settingPromoteBidirectionalDesc: "升级时把 wikilink 同时写进两篇笔记。关闭后只写入边的来源笔记。",
    noticeIndexCorrupt: "Vault Curate：索引文件已损坏，请重建索引。",
    indexingInProgress: "Vault Curate：正在索引中，请稍候",
    viewDisplayName: "语义搜索",
    mocTitleSearch: (query) => `MOC：${query}`,
    mocDescSearch: (query) => `「${query}」的搜索结果`,
    mocTitleRelated: (title) => `MOC：${title}`,
    mocDescRelated: (title) => `与「${title}」相关的笔记`,
    mocTitleGlobal: "MOC：全局发掘",
    mocDescGlobal: "与现有热门笔记最相关的冷门笔记",
    instructNav: "浏览",
    instructOpen: "打开笔记",
    instructOpenTab: "在新标签页打开",
    instructDismiss: "关闭",
    languageLabel: "简体中文",
    cmdGenerateMocGrouped: "生成 MOC（主题分组）",
    mocGroupedDescription: (query) => `主题分组的 MOC，来自查询：${query}`,
    mocMiscellaneous: "其他",
    mocMiscIntro: "与查询相关但未归入上述分组的笔记。",
    mocClusteringStatus: (current, total) => `正在分组 ${current}/${total} 篇笔记…`,
    mocNamingStatus: (current, total) => `正在命名分组 ${current}/${total}…`,
    mocTooFewResults: "结果少于 5 条，改为生成扁平 MOC",
    mocClusteringDegenerate: "结果主题过于相近，改为生成扁平 MOC",
    mocTooManyResults: (n) => `结果过多（${n} 条），请先用标签或文件夹过滤`,
    mocConfirmLarge: (n, seconds) => `${n} 篇笔记约需 ${seconds} 秒整理，是否继续？`,
    mocFallbackGroup: (n) => `分组 ${n}`,
    mocCanceled: "MOC 生成已取消，已保存部分结果。",
    mocLlmUnavailable: "LLM 不可用，分组已保存但未命名",
    mocClusterNamingPrompt: (languageLabel, notesBlock) => `你正在整理一个知识库。以下笔记因为讨论相关主题而被分为一组。根据共同主题，产出：

- title：精炼标题（3-8 个${languageLabel}字）
- intro：1-2 句介绍（40-80 字），描述这组笔记的共同主题

笔记：
${notesBlock}

只回复有效的 JSON（使用${languageLabel}）：
{"title": "...", "intro": "..."}`,
    llmPrompt: (title, content) => `任务：为笔记生成 description 和 tags。

规则：
1. description 必须使用简体中文，50-100 字，禁止使用英文或繁体中文
2. description 必须描述具体内容，禁止重复标题
3. 只描述笔记的内容主题，禁止描述笔记的格式或结构（如表格、统计、图表、字段）
4. tags 必须使用简体中文，3-5 个，不要 # 前缀，不能有空格
5. 只回复 JSON，不要解释

{"description": "...", "tags": ["...", "...", "..."]}

笔记标题：${title}

笔记内容：
${content}`,
};

const locales: Record<string, Locale> = { en, "zh-TW": zhTW, "zh-CN": zhCN };

export function getLocale(): Locale {
    // Use moment locale set by Obsidian (avoids direct localStorage access).
    // moment 的小写 locale 形如 "zh-cn" / "zh-tw" —— 按地区分发简繁。
    // ⚠ Migration trap: Obsidian 1.8+ offers getLanguage(), whose value space
    // differs from moment's — there bare "zh" means SIMPLIFIED ("zh-TW" is
    // Traditional), while in moment's space we map bare "zh" to Traditional.
    // Porting these rules to getLanguage() verbatim would flip Simplified
    // users back to Traditional. (Also: minAppVersion is currently < 1.8.)
    const lang = window.moment?.locale?.() ?? "en";
    if (lang.startsWith("zh")) {
        // 简体中文：大陆（zh-cn）、新加坡（zh-sg）、通用简体（zh-hans）
        if (lang === "zh-cn" || lang === "zh-sg" || lang.startsWith("zh-hans")) {
            return zhCN;
        }
        // 繁体：zh-tw / zh-hk / zh-hant，以及不带地区的裸 "zh"
        // （保持原作者的默认，避免改变既有繁体用户的体验）
        return zhTW;
    }
    return locales[lang] ?? en;
}

export const t = getLocale();
