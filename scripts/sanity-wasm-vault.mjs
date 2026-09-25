#!/usr/bin/env node
/**
 * Sanity check: simulate Phase 4 indexer pipeline using WASM bge-base-zh q8
 * over the user's vault. Confirms whether the WASM-default path hits the "under
 * 10 minutes for full rebuild" UX bar before we wire WASM into the plugin
 * main path.
 *
 * Mirrors the real pipeline:
 *   1. enumerate .md files (apply same exclude patterns as DEFAULT_SETTINGS)
 *   2. strip frontmatter
 *   3. extract title (frontmatter.title || first H1 || basename)
 *   4. split chunks (size=1000, overlap=200, title prefix per chunk)
 *   5. embed chunks with bge-base-zh q8 via @huggingface/transformers
 *   6. mean-pool to body_vec
 *
 * Differences vs Obsidian plugin:
 *   - Node-side ONNX runtime (not Electron renderer). Expected delta < 10%.
 *   - No SQLite writes (we only care about embedding cost; storage is negligible).
 */

import { pipeline, env } from '@huggingface/transformers';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const VAULT_PATH = process.argv[2]
    ?? '/Users/jacobmei/Library/Mobile Documents/iCloud~md~obsidian/Documents/Jacob';
const CHUNK_SIZE = Number(process.argv[3] ?? 1000);
const CHUNK_OVERLAP = Number(process.argv[4] ?? 200);

const EXCLUDE_PATTERNS = [
    '_templates/',
    'templates/',
    '.trash/',
    '_description_report.md',
    '3_wiki/',
];

// ─── Helpers (mirror src/indexer.ts + src/indexer/chunker.ts) ────────────────

function shouldExclude(relPath) {
    return EXCLUDE_PATTERNS.some(p => relPath.includes(p));
}

async function walkMd(dir, base, out) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(base, full);
        if (ent.isDirectory()) {
            if (ent.name.startsWith('.') && ent.name !== '.') continue;
            await walkMd(full, base, out);
        } else if (ent.isFile() && ent.name.endsWith('.md')) {
            if (!shouldExclude(rel)) out.push({ full, rel });
        }
    }
    return out;
}

function stripFrontmatter(content) {
    if (!content.startsWith('---')) return content;
    const end = content.indexOf('---', 3);
    if (end === -1) return content;
    return content.slice(end + 3).trim();
}

function extractTitle(content, basename) {
    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end !== -1) {
            const fm = content.slice(3, end);
            const m = fm.match(/^title:\s*(.+)$/m);
            if (m) {
                let t = m[1].trim();
                if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
                if (t.startsWith("'") && t.endsWith("'")) t = t.slice(1, -1);
                if (t) return t;
            }
        }
    }
    const body = stripFrontmatter(content);
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
    return basename;
}

function splitChunks(body, title, { chunkSize, chunkOverlap }) {
    const trimmed = body.trim();
    const prefix = title ? `${title}\n` : '';
    if (trimmed.length === 0) return [{ content: `${prefix}`.trimEnd(), chunkIndex: 0 }];
    const size = Math.max(1, chunkSize);
    const overlap = chunkOverlap >= size ? 0 : Math.max(0, chunkOverlap);
    const step = size - overlap;
    if (trimmed.length <= size) return [{ content: `${prefix}${trimmed}`, chunkIndex: 0 }];
    const out = [];
    let ci = 0;
    for (let i = 0; i < trimmed.length; i += step) {
        out.push({ content: `${prefix}${trimmed.slice(i, i + size)}`, chunkIndex: ci++ });
        if (i + size >= trimmed.length) break;
    }
    return out;
}

function meanPool(vecs) {
    const dim = vecs[0].length;
    const out = new Float32Array(dim);
    for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
    for (let i = 0; i < dim; i++) out[i] /= vecs.length;
    return out;
}

function fmtMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Vault path: ${VAULT_PATH}`);
    console.log(`chunkSize=${CHUNK_SIZE}, chunkOverlap=${CHUNK_OVERLAP}`);

    // Allow remote model download (default behaviour), cache to ~/.cache/huggingface
    env.allowLocalModels = true;
    env.allowRemoteModels = true;

    console.log('\n[1/3] Loading bge-base-zh q8 (downloads to ~/.cache/huggingface on first run)...');
    const tLoad = Date.now();
    const extractor = await pipeline(
        'feature-extraction',
        'Xenova/bge-base-zh',
        { dtype: 'q8' },
    );
    console.log(`  ✓ model loaded in ${fmtMs(Date.now() - tLoad)}`);

    console.log('\n[2/3] Walking vault for .md files...');
    const files = await walkMd(VAULT_PATH, VAULT_PATH, []) ?? [];
    console.log(`  ✓ found ${files.length} markdown files`);

    console.log('\n[3/3] Indexing pipeline (read → chunk → embed → mean-pool)...');
    const tStart = Date.now();
    let totalChunks = 0;
    let totalEmbedMs = 0;
    let dimension = 0;
    const chunkCounts = [];
    const perFileMs = [];

    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const t0 = Date.now();
        const content = await readFile(f.full, 'utf-8');
        const body = stripFrontmatter(content);
        const title = extractTitle(content, path.basename(f.rel, '.md'));
        const chunks = splitChunks(body, title, { chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP });

        const vecs = [];
        for (const c of chunks) {
            const tEmb = Date.now();
            const out = await extractor(c.content, { pooling: 'mean', normalize: true });
            totalEmbedMs += Date.now() - tEmb;
            vecs.push(out.data);
        }
        if (vecs.length > 0) {
            const bv = meanPool(vecs);
            if (dimension === 0) dimension = bv.length;
        }

        totalChunks += chunks.length;
        chunkCounts.push(chunks.length);
        perFileMs.push(Date.now() - t0);

        if ((i + 1) % 20 === 0 || i === files.length - 1) {
            const elapsed = Date.now() - tStart;
            const avg = elapsed / (i + 1);
            const eta = avg * (files.length - i - 1);
            console.log(
                `  ${i + 1}/${files.length} | elapsed ${fmtMs(elapsed)} | avg ${avg.toFixed(0)}ms/file | eta ${fmtMs(eta)} | chunks so far ${totalChunks}`,
            );
        }
    }

    const totalMs = Date.now() - tStart;
    const avgPerFile = totalMs / files.length;
    const avgPerChunk = totalEmbedMs / totalChunks;
    const sortedChunks = chunkCounts.slice().sort((a, b) => a - b);
    const sortedMs = perFileMs.slice().sort((a, b) => a - b);

    console.log('\n─── RESULTS ─────────────────────────────────────────────');
    console.log(`Files indexed       : ${files.length}`);
    console.log(`Total time          : ${fmtMs(totalMs)}`);
    console.log(`Embedding dimension : ${dimension}`);
    console.log(`Total chunks        : ${totalChunks}`);
    console.log(`Avg chunks/file     : ${(totalChunks / files.length).toFixed(1)} (median ${sortedChunks[Math.floor(files.length / 2)]}, p90 ${sortedChunks[Math.floor(files.length * 0.9)]}, max ${sortedChunks[files.length - 1]})`);
    console.log(`Avg embed time      : ${avgPerChunk.toFixed(1)}ms/chunk`);
    console.log(`Avg per-file time   : ${avgPerFile.toFixed(0)}ms (median ${sortedMs[Math.floor(files.length / 2)]}ms, p90 ${sortedMs[Math.floor(files.length * 0.9)]}ms, max ${sortedMs[files.length - 1]}ms)`);
    console.log(`Embedding fraction  : ${((totalEmbedMs / totalMs) * 100).toFixed(1)}% of wall time`);
    console.log('─────────────────────────────────────────────────────────');

    const minutes = totalMs / 60000;
    if (minutes <= 5) console.log(`✅ Under 10-min UX bar with significant margin (${minutes.toFixed(1)} min)`);
    else if (minutes <= 10) console.log(`✅ Within 10-min UX bar but tight (${minutes.toFixed(1)} min) — consider chunkSize tuning`);
    else console.log(`❌ Exceeds 10-min UX bar (${minutes.toFixed(1)} min) — need bigger chunkSize or smaller model`);
}

main().catch(err => {
    console.error('Sanity script failed:', err);
    process.exit(1);
});
