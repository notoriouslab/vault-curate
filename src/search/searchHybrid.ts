/**
 * Hybrid Fusion search (Phase 5 of 004-vault-curate-rebrand).
 *
 * Design rationale: see openspec/changes/004-vault-curate-rebrand/design.md D6.
 *
 * Three retrievers run in parallel:
 *   1. BM25 over chunk content (max-pooled per note)
 *   2. Semantic cosine over chunk vectors (max-pooled per note)
 *   3. Fuzzy title match (Jaro-Winkler)
 *
 * Results are fused via Reciprocal Rank Fusion (k=60). Tier scope filter
 * (hot / cold / all) is applied after fusion. Weights live in SQLiteStore
 * meta — Phase 8 Settings UI will expose them; for now they default to
 * 1.0 / 1.0 / 0.5.
 */
import type { EmbeddingProvider } from '../embedding';
import type { SQLiteStore } from '../storage/SQLiteStore';
import { blobToVec } from '../storage/vecCodec';
import type { SearchResult } from '../types';
import { fuzzyTitleSearch } from '../utils/jaroWinkler';
import { rrfFuse, topNFused } from './rrfFuse';
import { t2sForEmbed } from '../indexer/preproc';

const DEFAULT_WEIGHTS = { bm25: 1.0, semantic: 1.0, fuzzy: 0.5 };

// Hard caps on derived counts so a tampered topResults (or future settings
// drift) can't blow up BM25 / fusion / sort allocations in large vaults.
const MAX_CANDIDATE_POOL = 500;
const MAX_FUSED_TAKE = 300;

export type HybridWeights = { bm25: number; semantic: number; fuzzy: number };

export type SearchHybridDeps = {
    store: SQLiteStore;
    /** 015: null on mobile when no remote endpoint is configured — the
     *  semantic leg is skipped and BM25 + fuzzy carry the search. */
    provider: EmbeddingProvider | null;
};

export type SearchHybridSettings = {
    topResults: number;
    searchScope: 'hot' | 'cold' | 'all';
    /** 010 D5: query-time tier derivation; stored tier is the fallback. */
    tierResolver?: (path: string) => 'hot' | 'cold';
};

export function readHybridWeights(store: SQLiteStore): HybridWeights {
    const parse = (key: string, def: number): number => {
        const raw = store.getMeta(key);
        if (!raw) return def;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : def;
    };
    return {
        bm25: parse('weight_bm25', DEFAULT_WEIGHTS.bm25),
        semantic: parse('weight_semantic', DEFAULT_WEIGHTS.semantic),
        fuzzy: parse('weight_fuzzy', DEFAULT_WEIGHTS.fuzzy),
    };
}

export async function searchHybrid(
    query: string,
    deps: SearchHybridDeps,
    settings: SearchHybridSettings,
): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length === 0) return [];

    const tStart = Date.now();
    const candidatePool = Math.min(MAX_CANDIDATE_POOL, Math.max(50, settings.topResults * 5));
    const weights = readHybridWeights(deps.store);

    const tBm25 = Date.now();
    const tSemantic = Date.now();
    const tFuzzy = Date.now();
    const bm25P = runBM25(deps.store, q, candidatePool).then((m) => {
        console.debug(`vault-curate: BM25 ${m.size} hits (${Date.now() - tBm25}ms)`);
        return m;
    });
    // 015: no provider → the semantic leg is a no-op (layer 0, expected on
    // mobile); a present-but-failing provider degrades to keyword-only
    // instead of poisoning the whole Promise.all (rrfFuse skips empty maps).
    const semanticP = deps.provider === null
        ? Promise.resolve(new Map<string, number>())
        : runSemantic(deps.store, deps.provider, q).then((m) => {
            console.debug(`vault-curate: semantic ${m.size} hits (${Date.now() - tSemantic}ms)`);
            return m;
        }).catch((e) => {
            console.warn("vault-curate: semantic leg failed, falling back to keyword-only", e);
            return new Map<string, number>();
        });
    const fuzzyP = Promise.resolve(fuzzyTitleSearch(q, deps.store.getAllTitles(), candidatePool)).then((m) => {
        console.debug(`vault-curate: fuzzy ${m.size} hits (${Date.now() - tFuzzy}ms)`);
        return m;
    });
    const [bm25Map, semanticMap, fuzzyMap] = await Promise.all([bm25P, semanticP, fuzzyP]);

    const fused = rrfFuse(
        [bm25Map, semanticMap, fuzzyMap],
        [weights.bm25, weights.semantic, weights.fuzzy],
    );

    // Take generously, then apply scope filter, then trim to topResults.
    const top = topNFused(fused, Math.min(MAX_FUSED_TAKE, settings.topResults * 3));
    const out = materialise(top, deps.store, settings);
    console.debug(
        `vault-curate: hybrid '${q}' → ${out.length}/${fused.size} results in ${Date.now() - tStart}ms ` +
        `(weights ${weights.bm25}/${weights.semantic}/${weights.fuzzy}, scope=${settings.searchScope})`,
    );
    if (out.length > 0) {
        const preview = out.slice(0, 5).map((r, i) => `${i + 1}. ${r.title} (${r.score.toFixed(4)})`).join(' | ');
        console.debug(`vault-curate: top — ${preview}`);
    }
    return out;
}

function runBM25(
    store: SQLiteStore,
    query: string,
    limit: number,
): Promise<Map<string, number>> {
    // We pull more chunk hits than we need so max-pooling per note has room
    // to cover notes whose top chunk isn't the absolute best globally.
    const hits = store.searchBM25(query, limit * 2);
    const out = new Map<string, number>();
    for (const h of hits) {
        const cur = out.get(h.notePath);
        if (cur === undefined || h.bm25Score > cur) {
            out.set(h.notePath, h.bm25Score);
        }
    }
    return Promise.resolve(out);
}

async function runSemantic(
    store: SQLiteStore,
    provider: EmbeddingProvider,
    query: string,
): Promise<Map<string, number>> {
    // The indexer's `ensureProviderReady` only fires from rebuild/update/indexSingleFile.
    // A user who reopens Obsidian and searches without re-indexing must trigger
    // warmup here — otherwise the WASM provider throws on the first embed().
    if (!(await provider.isReady())) {
        await provider.warmup();
    }
    // 008 D3: query embeds in the same t2s-converted space as the index
    // (Traditional stays everywhere else — BM25 leg below uses raw query).
    const queryVec = (await provider.embed([t2sForEmbed(query)]))[0];
    if (!queryVec || queryVec.length === 0) return new Map();

    const out = new Map<string, number>();
    // getAllChunksRaw keeps the vec as Uint8Array; we decode lazily and only
    // hold one Float32Array view per chunk in scope, which is fine — the
    // bottleneck is the cosine loop, not allocation.
    for (const c of store.getAllChunksRaw()) {
        const v = blobToVec(c.vec);
        const cos = cosineSim(queryVec, v);
        const cur = out.get(c.notePath);
        if (cur === undefined || cos > cur) {
            out.set(c.notePath, cos);
        }
    }
    return out;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

function materialise(
    top: Array<{ docId: string; score: number }>,
    store: SQLiteStore,
    settings: SearchHybridSettings,
): SearchResult[] {
    const out: SearchResult[] = [];
    for (const { docId, score } of top) {
        const note = store.getNote(docId);
        if (!note) continue;
        const tier: 'hot' | 'cold' = settings.tierResolver?.(docId)
            ?? (note.tier === 'cold' ? 'cold' : 'hot');
        if (settings.searchScope === 'hot' && tier !== 'hot') continue;
        if (settings.searchScope === 'cold' && tier !== 'cold') continue;
        out.push({
            path: docId,
            title: note.title,
            tags: [], // Phase 5 doesn't track tags in SQLiteStore; revisit if UI uses them.
            score,
            tier,
        });
        if (out.length >= settings.topResults) break;
    }
    return out;
}
