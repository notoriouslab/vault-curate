/**
 * Pure-TypeScript BM25 ranking for vault-curate.
 *
 * Why not FTS5: sql.js (v1.14.1, the version we bundle) ships without FTS5
 * extension compiled in (only FTS3 + FTS4 are enabled). Rather than swap to a
 * different SQLite WASM distribution (e.g. @sqlite.org/sqlite-wasm) — which
 * would mean changing the entire storage API surface — we keep sql.js for
 * its battle-tested simplicity and compute BM25 in TypeScript instead.
 *
 * Tokenisation uses the same `cjkTokenize` rules as design.md D2 specified for
 * FTS5 (CJK trigrams + ASCII words), so query/doc tokens line up consistently.
 */
import { tokenizeCJK } from './cjkTokenize';
import { t2sForEmbed } from '../indexer/preproc';

/** 029: variant-character (異體字) merges Simplified doesn't provide. The
 *  t2s pivot below collapses 臺/台, 裏/裡, 綫/線, 爲/為 … for free, but 劃
 *  and 畫 map to distinct Simplified chars (划/画) while TW writing mixes
 *  them freely inside the same words — measured on a real vault: 規劃書 vs
 *  規畫書 split 90:114 and a 規畫書 query found 1 of 10 規劃書 notes. */
const SEARCH_MERGE_PATCH_RE = /画/g;

/** 029: fold character variants before tokenizing so the keyword leg stops
 *  splitting on spelling (查 規畫書 must find 規劃書). Reuses the embedding
 *  leg's t2s table (008) — both legs now see the same equivalence classes.
 *  False merges (發/髮→发, 面/麵→面, 里/裡→里 …) are bounded by the trigram
 *  window: an adversarial pilot of 22 such probes on the real corpus showed
 *  0 perturbed results. Applied to BOTH corpus and query via
 *  tokenizeForBM25, so the two sides can never disagree. */
export function normalizeForSearch(text: string): string {
    return t2sForEmbed(text).replace(SEARCH_MERGE_PATCH_RE, '划');
}

export type BM25Doc = {
    id: string;       // opaque caller-supplied identifier (e.g. `${notePath}#${chunkIndex}`)
    tokens: string[]; // pre-tokenised content (output of tokenizeForBM25)
};

export type BM25Hit = {
    id: string;
    score: number;
};

/**
 * Tokenise text into BM25-ready tokens. Wraps `tokenizeCJK` to produce an array
 * rather than a space-joined string.
 */
export function tokenizeForBM25(text: string): string[] {
    if (!text) return [];
    const s = tokenizeCJK(normalizeForSearch(text));
    if (!s) return [];
    return s.split(' ').filter((t) => t.length > 0);
}

/**
 * Compute IDF for each unique query term over the document collection.
 * Uses BM25+ variant: IDF(t) = ln((N - df + 0.5) / (df + 0.5) + 1) → always ≥ 0.
 */
export function computeIdf(queryTokens: string[], docs: BM25Doc[]): Map<string, number> {
    const idf = new Map<string, number>();
    if (queryTokens.length === 0 || docs.length === 0) return idf;

    const uniqueTerms = new Set(queryTokens);
    const df = new Map<string, number>();
    for (const term of uniqueTerms) df.set(term, 0);

    for (const doc of docs) {
        const seen = new Set(doc.tokens);
        for (const term of uniqueTerms) {
            if (seen.has(term)) df.set(term, df.get(term)! + 1);
        }
    }

    const N = docs.length;
    for (const term of uniqueTerms) {
        const dfVal = df.get(term) ?? 0;
        idf.set(term, Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1));
    }
    return idf;
}

/**
 * Score every document against the query and return the top-`limit` matches.
 * Docs with zero matching terms are excluded.
 *
 * BM25 formula: Σ IDF(qi) * (tf * (k1+1)) / (tf + k1 * (1 - b + b * |D|/avgdl))
 * Defaults k1=1.5, b=0.75 (standard).
 */
/**
 * Prebuilt inverted index (007 D9).
 *
 * Why: computeIdf + scoreBM25 walk every document per query; together with
 * re-tokenizing the whole corpus that made every search ~2s on a 10k-doc
 * vault. The index makes queries sparse — only postings lists of the query
 * terms are touched (<1ms measured on the same vault).
 *
 * Memory: terms are FNV-1a 32-bit hashes and postings live in typed arrays
 * (CSR layout), ~45MB for a 1.1M-term vocabulary vs ~300MB for naive
 * Map<string, ...> postings. Hash collisions (expected ~140 pairs at 1.1M
 * terms) merge two terms' postings — a negligible df/tf perturbation.
 *
 * Equivalence with the walk-everything path is pinned by tests
 * (test/bm25Index.test.ts): identical ids and scores on shared fixtures.
 */
export type BM25Index = {
    /** Sorted unique term hashes (binary-searched at query time). */
    termHashes: Uint32Array;
    /** CSR offsets into postDocs/postTfs; length = termHashes.length + 1. */
    termOffsets: Uint32Array;
    /** Document index of each posting. */
    postDocs: Uint32Array;
    /** Term frequency of each posting (capped at 65535). */
    postTfs: Uint16Array;
    docIds: string[];
    docLens: Float64Array;
    avgdl: number;
};

/** FNV-1a 32-bit over UTF-16 code units. */
function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export function buildBM25Index(docs: BM25Doc[]): BM25Index {
    // Pass 1: per-doc tf maps keyed by term hash, accumulated per term.
    const perTerm = new Map<number, number[]>(); // hash → [docIdx, tf, ...]
    const docLens = new Float64Array(docs.length);
    const docIds = new Array<string>(docs.length);
    let totalLen = 0;
    for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        docIds[i] = d.id;
        docLens[i] = d.tokens.length;
        totalLen += d.tokens.length;
        const tf = new Map<number, number>();
        for (const tok of d.tokens) {
            const h = fnv1a(tok);
            tf.set(h, (tf.get(h) ?? 0) + 1);
        }
        for (const [h, f] of tf) {
            let arr = perTerm.get(h);
            if (!arr) {
                arr = [];
                perTerm.set(h, arr);
            }
            arr.push(i, Math.min(f, 65535));
        }
    }

    // Pass 2: pack into CSR typed arrays, terms sorted by hash.
    const termHashes = new Uint32Array(perTerm.size);
    let t = 0;
    for (const h of perTerm.keys()) termHashes[t++] = h;
    termHashes.sort();

    let postingCount = 0;
    for (const arr of perTerm.values()) postingCount += arr.length / 2;
    const termOffsets = new Uint32Array(termHashes.length + 1);
    const postDocs = new Uint32Array(postingCount);
    const postTfs = new Uint16Array(postingCount);
    let cursor = 0;
    for (let i = 0; i < termHashes.length; i++) {
        termOffsets[i] = cursor;
        // Explicit guard instead of a bare non-null assertion: hashes come
        // straight from perTerm.keys(), but Dashboard audits flag unguarded
        // `!` and the invariant deserves defending against refactors.
        const arr = perTerm.get(termHashes[i]);
        if (!arr) continue;
        for (let j = 0; j < arr.length; j += 2) {
            postDocs[cursor] = arr[j];
            postTfs[cursor] = arr[j + 1];
            cursor++;
        }
    }
    termOffsets[termHashes.length] = cursor;

    return {
        termHashes,
        termOffsets,
        postDocs,
        postTfs,
        docIds,
        docLens,
        avgdl: docs.length > 0 ? totalLen / docs.length : 0,
    };
}

function findTerm(hashes: Uint32Array, h: number): number {
    let lo = 0, hi = hashes.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (hashes[mid] === h) return mid;
        if (hashes[mid] < h) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/**
 * Sparse BM25 over the prebuilt index. Same formula and defaults as
 * scoreBM25 (BM25+ IDF, k1=1.5, b=0.75) — equivalence pinned by tests.
 */
export function searchBM25Index(
    index: BM25Index,
    queryTokens: string[],
    limit: number,
    k1 = 1.5,
    b = 0.75,
): BM25Hit[] {
    const N = index.docIds.length;
    if (queryTokens.length === 0 || N === 0 || index.avgdl === 0) return [];

    // Query-term multiplicity matters: the legacy path iterates queryTokens
    // WITH duplicates, so a term repeated k times contributes k× (implicit
    // query-tf weighting — real trigger: CJK reduplication like 哈哈哈哈
    // produces identical trigrams). Deduping with a plain Set halved those
    // scores (audit finding C1) — weight each unique term by its count.
    const queryTf = new Map<string, number>();
    for (const tok of queryTokens) queryTf.set(tok, (queryTf.get(tok) ?? 0) + 1);

    const scores = new Map<number, number>();
    for (const [term, qtf] of queryTf) {
        const ti = findTerm(index.termHashes, fnv1a(term));
        if (ti < 0) continue;
        const start = index.termOffsets[ti];
        const end = index.termOffsets[ti + 1];
        const df = end - start;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        if (idf <= 0) continue;
        for (let p = start; p < end; p++) {
            const di = index.postDocs[p];
            const f = index.postTfs[p];
            const norm = 1 - b + b * (index.docLens[di] / index.avgdl);
            scores.set(di, (scores.get(di) ?? 0) + qtf * idf * ((f * (k1 + 1)) / (f + k1 * norm)));
        }
    }

    const hits: BM25Hit[] = [];
    for (const [di, score] of scores) hits.push({ id: index.docIds[di], score });
    hits.sort((a, b2) => b2.score - a.score);
    return hits.slice(0, limit);
}

export function scoreBM25(
    queryTokens: string[],
    docs: BM25Doc[],
    idf: Map<string, number>,
    limit: number,
    k1 = 1.5,
    b = 0.75,
): BM25Hit[] {
    if (queryTokens.length === 0 || docs.length === 0) return [];

    let totalLen = 0;
    for (const d of docs) totalLen += d.tokens.length;
    const avgdl = totalLen / docs.length;
    if (avgdl === 0) return [];

    const hits: BM25Hit[] = [];
    for (const doc of docs) {
        const tf = new Map<string, number>();
        for (const tok of doc.tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

        const dl = doc.tokens.length;
        const norm = 1 - b + b * (dl / avgdl);

        let score = 0;
        let matched = false;
        for (const qt of queryTokens) {
            const w = idf.get(qt) ?? 0;
            if (w <= 0) continue;
            const f = tf.get(qt) ?? 0;
            if (f === 0) continue;
            matched = true;
            score += w * ((f * (k1 + 1)) / (f + k1 * norm));
        }
        if (matched) hits.push({ id: doc.id, score });
    }

    hits.sort((a, b2) => b2.score - a.score);
    return hits.slice(0, limit);
}
