/**
 * Indexer test harness (034 T3): a real in-memory SQLiteStore, a fake plugin
 * exposing only the members indexer.ts reads, and fake providers.
 *
 * Notes are plain objects keyed by path; bodies are served by cachedRead and
 * titles fall back to the basename (no frontmatter, no headings).
 */
import { readFileSync } from 'fs';
import { vi } from 'vitest';
import { TFile } from 'obsidian';
import { SQLiteStore, type PersistAdapter } from '../../src/storage/SQLiteStore';
import { Indexer } from '../../src/indexer';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { EmbeddingProvider } from '../../src/embedding/EmbeddingProvider';
import type { Chunk } from '../../src/indexer/chunker';
import { splitChunksByTokens, TOKEN_CHUNK_POLICY } from '../../src/indexer/tokenChunker';

const memAdapter: PersistAdapter = {
    read: async () => null,
    write: async () => { /* in-memory */ },
    exists: async () => false,
};
const wasmBytes = () => new Uint8Array(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm'));

export function makeFile(path: string, mtime = 1): TFile {
    const f = new TFile();
    f.path = path;
    f.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
    f.stat = { mtime, ctime: mtime, size: 0 };
    return f;
}

export interface FakeProviderOptions {
    /** Built-in-like: advertise the token policy and chunk via splitForEmbed. */
    tokenPolicy: boolean;
    /** Paths whose embed call throws (checked against the chunk text). */
    failPaths?: Set<string>;
}

export type FakeProvider = EmbeddingProvider & {
    splitCalls: string[];
    embedCalls: number;
    warmupCalls: number;
};

/** Chunk content starts with the note title, which the harness sets to the basename. */
function titleOf(text: string): string {
    return text.split('\n')[0];
}

export function makeProvider(opts: FakeProviderOptions): FakeProvider {
    const p: FakeProvider = {
        providerType: opts.tokenPolicy ? 'wasm' : 'ollama',
        modelId: 'fake-model',
        dimension: 2,
        displayName: 'fake',
        splitCalls: [],
        embedCalls: 0,
        warmupCalls: 0,
        warmup: async () => { p.warmupCalls++; },
        isReady: async () => true,
        embed: async (texts: string[]) => {
            p.embedCalls++;
            for (const t of texts) {
                if (opts.failPaths?.has(titleOf(t))) throw new Error(`embed failed for ${titleOf(t)}`);
            }
            return texts.map(() => new Float32Array([1, 0]));
        },
        dispose: () => {},
    };
    if (opts.tokenPolicy) {
        Object.assign(p, {
            chunkPolicy: TOKEN_CHUNK_POLICY,
            splitForEmbed: async (body: string, title: string): Promise<Chunk[]> => {
                p.splitCalls.push(title);
                return splitChunksByTokens(body, title, (s) => [...s].length + 2, {
                    maxTokens: 512, overlapChars: 50, maxWindowChars: 2000, maxTitleChars: 64,
                });
            },
        });
    }
    return p;
}

export interface Harness {
    store: SQLiteStore;
    indexer: Indexer;
    files: Map<string, { file: TFile; body: string }>;
    setProvider(p: EmbeddingProvider): void;
}

export async function makeHarness(notes: Record<string, string>, provider: EmbeddingProvider): Promise<Harness> {
    const store = await SQLiteStore.open(memAdapter, 'test.db', wasmBytes());
    const files = new Map<string, { file: TFile; body: string }>();
    for (const [path, body] of Object.entries(notes)) files.set(path, { file: makeFile(path), body });

    const plugin = {
        app: {
            vault: {
                configDir: '.obsidian',
                getMarkdownFiles: () => [...files.values()].map((e) => e.file),
                cachedRead: async (f: TFile) => {
                    const e = files.get(f.path);
                    if (!e) throw new Error(`no such file ${f.path}`);
                    return e.body;
                },
                getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null,
            },
            metadataCache: {
                getFileCache: () => ({}),
                resolvedLinks: {},
            },
        },
        settings: { ...DEFAULT_SETTINGS },
        selfWrites: {},
        scheduleBM25Warm: vi.fn(),
    };
    // The indexer only touches the members above; the cast keeps the harness
    // from having to construct a whole Plugin.
    const indexer = new Indexer(plugin as never, store, provider);
    return {
        store,
        indexer,
        files,
        setProvider: (p) => indexer.setBackends(store, p),
    };
}

export const noteNames = (n: number) => Array.from({ length: n }, (_, i) => `note${i}.md`);
export const notesWith = (n: number) =>
    Object.fromEntries(noteNames(n).map((p, i) => [p, `內容 ${i} `.repeat(30)]));
