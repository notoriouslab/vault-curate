/**
 * 030 T3(b) — functional acceptance probe for the two-char query floor.
 *
 * Reads a real vault ONCE and, on that single snapshot, tokenizes every note
 * both ways (query-side tokenizer = Before, corpus-side bigram tokenizer =
 * After) and reports how many notes are findable by the first two CJK chars
 * of their own title.
 *
 * Run:   npx tsx scripts/probe-2char-floor.ts [vault-path]
 * Output (single line, machine-checkable):  before=X/N after=Y/N
 * Acceptance (proposal D4.1): after/N >= 0.92
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tokenizeForBM25, tokenizeForBM25Corpus } from '../src/storage/bm25';

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

let total = 0;
let before = 0;
let after = 0;
const misses: string[] = [];
for (const f of mdFiles(vault)) {
    const title = f.split('/').pop()!.replace(/\.md$/, '');
    const run = (title.match(/[㐀-鿿]{2,}/) || [])[0];
    if (!run) continue;
    total++;
    const q = tokenizeForBM25(run.slice(0, 2));
    const text = title + '\n' + readFileSync(f, 'utf-8');
    const beforeSet = new Set(tokenizeForBM25(text));
    const afterSet = new Set(tokenizeForBM25Corpus(text));
    if (q.every((t) => beforeSet.has(t))) before++;
    if (q.every((t) => afterSet.has(t))) after++;
    else misses.push(`${run.slice(0, 2)} miss: ${title}`);
}

console.log(`before=${before}/${total} after=${after}/${total}`);
for (const m of misses) console.log(m);
process.exit(total > 0 && after / total >= 0.92 ? 0 : 1);
