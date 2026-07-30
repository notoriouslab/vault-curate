// 014 Task 3 probe (GATE): incremental-maintenance correctness on REAL
// vault vectors. Replays R simulated re-embeds through applyNoteUpserted
// and compares the drifted graph against a full rebuild of the same final
// vectors: verdict agreement (connected / weak / none), bottleneck |Δ|,
// edge Jaccard, per-increment latency. Sweeps drift levels to calibrate
// REBUILD_DRIFT_RATIO. PASS line: agreement ≥95% AND |Δ| p95 ≤ 0.01 at the
// chosen ratio.
//
// Run (esbuild-bundled — plain node cannot import TS):
//   npx esbuild scripts/probe014.ts --bundle --platform=node --format=cjs \
//     --outfile=/tmp/probe014.cjs && node /tmp/probe014.cjs [index.sqlite path]

import * as fs from 'fs';
import initSqlJs from 'sql.js';
import { composeNoteVec } from '../src/utils/composeVec';
import { blobToVec } from '../src/storage/vecCodec';
import {
    DEFAULT_KNN_K,
    DEFAULT_MAX_HOPS,
    KNN_SAME_FOLDER_CAP,
    BOTTLENECK_PERCENTILE,
    widestPath,
    edgeSimPercentile,
    type KnnGraph,
} from '../src/search/semanticPath';
import {
    createKnnState,
    applyNoteUpserted,
    deriveGraph,
    type KnnState,
} from '../src/search/knnIncremental';
import { pairKey } from '../src/utils/pairKey';

const PLUGIN = `${process.env.HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Jacob/.obsidian/plugins/vault-curate`;
const DB_PATH = process.argv[2] ?? `${PLUGIN}/index.sqlite`;
const ALPHA = 0.5; // DEFAULT_SETTINGS.descWeight

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

/** 5% gaussian perturbation, renormalized — "small edit". */
function perturb(vec: Float32Array, rnd: () => number): Float32Array {
    const out = new Float32Array(vec.length);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
        const g = (rnd() + rnd() + rnd() + rnd() - 2) / 2; // approx N(0,~0.29)
        out[i] = vec[i] + 0.05 * g;
        norm += out[i] * out[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
}

type Verdict = 'none' | 'weak' | 'connected';

function verdictOf(graph: KnnGraph, threshold: number, from: string, to: string): { v: Verdict; b: number | null } {
    const r = widestPath(graph, from, to, DEFAULT_MAX_HOPS);
    if (!r) return { v: 'none', b: null };
    if (r.bottleneck < threshold) return { v: 'weak', b: r.bottleneck };
    return { v: 'connected', b: r.bottleneck };
}

function edgeSet(graph: KnnGraph): Set<string> {
    const s = new Set<string>();
    for (const [from, edges] of graph) {
        for (const e of edges) s.add(pairKey(from, e.path));
    }
    return s;
}

function pct(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const rank = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

interface DriftResult {
    label: string;
    edits: number;
    agree: number;
    total: number;
    deltas: number[];
    jaccard: number;
    thrInc: number;
    thrFull: number;
    msPerEdit: number;
}

function runDrift(
    notes: Array<{ path: string; vec: Float32Array }>,
    edits: number,
    label: string,
    seed: number,
): DriftResult {
    const rnd = lcg(seed);
    const state: KnnState = createKnnState(notes, DEFAULT_KNN_K, KNN_SAME_FOLDER_CAP);
    const current = new Map(notes.map((n) => [n.path, n.vec]));

    const t0 = Date.now();
    for (let e = 0; e < edits; e++) {
        const path = notes[Math.floor(rnd() * notes.length)].path;
        const base = current.get(path)!;
        // Half small edits (perturbation), half rewrites (another note's vector).
        const next = rnd() < 0.5
            ? perturb(base, rnd)
            : notes[Math.floor(rnd() * notes.length)].vec.slice();
        current.set(path, next);
        applyNoteUpserted(state, path, next, DEFAULT_KNN_K, KNN_SAME_FOLDER_CAP);
    }
    const msPerEdit = (Date.now() - t0) / Math.max(1, edits);

    const incGraph = deriveGraph(state);
    const thrInc = edgeSimPercentile(incGraph, BOTTLENECK_PERCENTILE);

    const finalNotes = notes.map((n) => ({ path: n.path, vec: current.get(n.path)! }));
    const fullState = createKnnState(finalNotes, DEFAULT_KNN_K, KNN_SAME_FOLDER_CAP);
    const fullGraph = deriveGraph(fullState);
    const thrFull = edgeSimPercentile(fullGraph, BOTTLENECK_PERCENTILE);

    const incEdges = edgeSet(incGraph);
    const fullEdges = edgeSet(fullGraph);
    let inter = 0;
    for (const k of incEdges) if (fullEdges.has(k)) inter++;
    const jaccard = inter / (incEdges.size + fullEdges.size - inter);

    const pairRnd = lcg(seed + 7);
    let agree = 0;
    const deltas: number[] = [];
    const SAMPLES = 200;
    for (let s = 0; s < SAMPLES; s++) {
        const a = notes[Math.floor(pairRnd() * notes.length)].path;
        let b = notes[Math.floor(pairRnd() * notes.length)].path;
        if (b === a) b = notes[(notes.findIndex((n) => n.path === a) + 1) % notes.length].path;
        const vi = verdictOf(incGraph, thrInc, a, b);
        const vf = verdictOf(fullGraph, thrFull, a, b);
        if (vi.v === vf.v) agree++;
        if (vi.b !== null && vf.b !== null) deltas.push(Math.abs(vi.b - vf.b));
    }
    deltas.sort((x, y) => x - y);
    return { label, edits, agree, total: SAMPLES, deltas, jaccard, thrInc, thrFull, msPerEdit };
}

async function main() {
    const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(`${PLUGIN}/sql-wasm.wasm`) });
    const db = new SQL.Database(fs.readFileSync(DB_PATH));
    const rows = db.exec('SELECT path, body_vec, desc_vec FROM notes WHERE body_vec IS NOT NULL')[0].values;
    const notes: Array<{ path: string; vec: Float32Array }> = [];
    for (const r of rows) {
        notes.push({
            path: r[0] as string,
            vec: composeNoteVec(blobToVec(r[1] as Uint8Array), r[2] ? blobToVec(r[2] as Uint8Array) : null, ALPHA),
        });
    }
    const N = notes.length;
    const dim = notes[0].vec.length;
    console.log(`# probe014 — N=${N}, dim=${dim}, K=${DEFAULT_KNN_K}, cap=${KNN_SAME_FOLDER_CAP}, p=${BOTTLENECK_PERCENTILE}`);

    const experiments = [
        { edits: 50, label: 'base R=50 (~2%)' },
        { edits: Math.round(N * 0.05), label: 'drift 5%' },
        { edits: Math.round(N * 0.10), label: 'drift 10%' },
        { edits: Math.round(N * 0.20), label: 'drift 20%' },
    ];
    console.log('| 檔位 | edits | verdict 一致率 | |Δ| p50 | |Δ| p95 | |Δ| max | 邊 Jaccard | thr inc/full | ms/edit |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const ex of experiments) {
        const r = runDrift(notes, ex.edits, ex.label, 20260730);
        const rate = ((r.agree / r.total) * 100).toFixed(1);
        console.log(
            `| ${r.label} | ${r.edits} | ${r.agree}/${r.total} (${rate}%) | ${pct(r.deltas, 50).toFixed(4)} | ${pct(r.deltas, 95).toFixed(4)} | ${(r.deltas[r.deltas.length - 1] ?? 0).toFixed(4)} | ${(r.jaccard * 100).toFixed(1)}% | ${r.thrInc.toFixed(4)}/${r.thrFull.toFixed(4)} | ${r.msPerEdit.toFixed(1)} |`,
        );
    }
}

void main();
