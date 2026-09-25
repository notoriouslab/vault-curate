/**
 * 030 T4 — corpus bigram emission cost + rank stability, real engine.
 *
 * Part 1 (synthetic 5k chunks): warm/build time, index bytes, query latency
 * for Before (trigram-only corpus) vs After (trigram+bigram corpus).
 * Acceptance (proposal D4.2): query latency delta < 10ms.
 *
 * Part 2 (real vault, G4 per proposal D1): for >=3-char real queries, mean
 * displacement of Before top-10 docs in the After ranking (dropped out = 10).
 * Acceptance: overall mean <= 2.0.
 *
 * Run:   npx tsx scripts/bench-030-bigram.ts [vault-path]
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
    tokenizeForBM25,
    tokenizeForBM25Corpus,
    buildBM25Index,
    searchBM25Index,
    BM25Doc,
    BM25Index,
} from '../src/storage/bm25';

// ── Part 1: synthetic 5k chunks ─────────────────────────────────────────────
// Deterministic LCG so runs are comparable.
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const CJK_START = 0x4e00;
const randChar = () => String.fromCharCode(CJK_START + Math.floor(rand() * 2000));
const randChunk = () => {
    // ~500 chars in runs of 2-12 separated by punctuation, plus ASCII words
    let s = '';
    while (s.length < 500) {
        const runLen = 2 + Math.floor(rand() * 11);
        for (let i = 0; i < runLen; i++) s += randChar();
        s += rand() < 0.15 ? ' note ' : '，';
    }
    return s;
};

const texts: string[] = [];
for (let i = 0; i < 5000; i++) texts.push(randChunk());

function buildTimed(tok: (t: string) => string[]): { idx: BM25Index; buildMs: number; bytes: number } {
    const t0 = performance.now();
    const docs: BM25Doc[] = texts.map((t, i) => ({ id: `c${i}`, tokens: tok(t) }));
    const idx = buildBM25Index(docs);
    const buildMs = performance.now() - t0;
    const bytes =
        idx.termHashes.byteLength + idx.termOffsets.byteLength +
        idx.postDocs.byteLength + idx.postTfs.byteLength + idx.docLens.byteLength;
    return { idx, buildMs, bytes };
}

const B = buildTimed(tokenizeForBM25);
const A = buildTimed(tokenizeForBM25Corpus);

// query mix: 2-char, 3-char, 5-char CJK pulled from the corpus itself
const queries: string[] = [];
for (let i = 0; i < 60; i++) {
    const t = texts[Math.floor(rand() * texts.length)];
    const run = (t.match(/[㐀-鿿]{6,}/) || ['中文測試字串樣本'])[0];
    queries.push(run.slice(0, 2), run.slice(0, 3), run.slice(0, 5));
}
function queryTimed(idx: BM25Index): number {
    const t0 = performance.now();
    for (const q of queries) searchBM25Index(idx, tokenizeForBM25(q), 20);
    return (performance.now() - t0) / queries.length;
}
// warm up JIT once, then measure
queryTimed(B.idx); queryTimed(A.idx);
const qB = queryTimed(B.idx);
const qA = queryTimed(A.idx);

console.log('── synthetic 5k chunks ──');
console.log(`build: before=${B.buildMs.toFixed(0)}ms after=${A.buildMs.toFixed(0)}ms`);
console.log(`index bytes: before=${(B.bytes / 1e6).toFixed(1)}MB after=${(A.bytes / 1e6).toFixed(1)}MB (${(A.bytes / B.bytes).toFixed(2)}x)`);
console.log(`query mean: before=${qB.toFixed(3)}ms after=${qA.toFixed(3)}ms delta=${(qA - qB).toFixed(3)}ms (gate <10ms)`);

// ── Part 2: real-vault rank stability (G4) ─────────────────────────────────
const vault = process.argv[2] ?? `${process.env.HOME}/Obsidian/Jacob`;
function mdFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        if (e.startsWith('.')) continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) mdFiles(p, out);
        else if (e.endsWith('.md')) out.push(p);
    }
    return out;
}
const files = mdFiles(vault);
const load = (tok: (t: string) => string[]): BM25Doc[] =>
    files.map((f) => ({
        id: f,
        tokens: tok(f.split('/').pop()!.replace(/\.md$/, '') + '\n' + readFileSync(f, 'utf-8')),
    }));
const idxVB = buildBM25Index(load(tokenizeForBM25));
const idxVA = buildBM25Index(load(tokenizeForBM25Corpus));

const realQueries = ['規劃書', '金管會', '智慧詩歌', '搜尋系統', '健檢數據',
    '語意搜尋', '監管框架', '提示詞', '晶片災難', '全文搜尋引擎', '發布流程'];
console.log('── real vault G4 rank stability ──');
let sum = 0;
let n = 0;
for (const q of realQueries) {
    const qt = tokenizeForBM25(q);
    const rb = searchBM25Index(idxVB, qt, 10).map((h) => h.id);
    if (rb.length === 0) { console.log(`  ${q}: no hits before, skip`); continue; }
    const ra = searchBM25Index(idxVA, qt, 10).map((h) => h.id);
    let d = 0;
    rb.forEach((id, r) => {
        const r2 = ra.indexOf(id);
        d += r2 < 0 ? 10 : Math.abs(r - r2);
    });
    const mean = d / rb.length;
    sum += mean;
    n++;
    console.log(`  ${q}: mean displacement ${mean.toFixed(2)}`);
}
const overall = sum / n;
console.log(`overall mean displacement = ${overall.toFixed(2)} (gate <=2.0)`);
process.exit(qA - qB < 10 && overall <= 2.0 ? 0 : 1);
