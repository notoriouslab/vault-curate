/**
 * CJK trigram tokenizer for FTS5 indexing.
 *
 * FTS5's built-in `unicode61` tokenizer treats whole CJK strings as a single token
 * (no word boundaries between Chinese characters), making BM25 search useless for
 * Chinese vaults. This module pre-tokenizes content into trigrams so that FTS5 can
 * index meaningful sub-strings.
 *
 * Strategy:
 *   - CJK character runs: emit overlapping trigrams (sliding window of 3, step 1).
 *     A run of length 1 or 2 emits a single token of that length.
 *   - ASCII alphanumeric runs: emit lowercased word as-is (preserves "GPT-4" intact).
 *   - Everything else (whitespace, punctuation, symbols): break the run, no token.
 *
 * Apply to both content (write to chunks_fts.content) and queries (before MATCH).
 */
/**
 * Bumped when tokenization output changes so the indexer can force a rebuild
 * on upgrade — old BM25 tokens won't match new query tokens otherwise.
 *
 * 029 correction: BM25 tokens are NOT persisted anywhere — collectBM25Docs
 * re-tokenizes chunk content at every warm, so index-side and query-side
 * tokens always come from the same code. Bumping this forces a full
 * re-embed rebuild for nothing; it stays for the historical 1→2 upgrade
 * path and MUST only be bumped again if tokens ever become persisted.
 * (029's variant folding changed tokenizer output and deliberately did
 * not bump it.)
 *
 *   1 → 2  (rc.1 hardening r2): emit surrogate-pair codepoints (emoji,
 *           CJK Extension B+) as single tokens instead of dropping them.
 */
export const TOKENIZER_VERSION = '2';

const CJK_RE = /[㐀-鿿豈-﫿]/;
const ASCII_WORD_RE = /[a-zA-Z0-9_-]/;

function isCJK(ch: string): boolean {
    return CJK_RE.test(ch);
}

function isAsciiWord(ch: string): boolean {
    return ASCII_WORD_RE.test(ch);
}

function isHighSurrogate(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code >= 0xd800 && code <= 0xdbff;
}

export function tokenizeCJK(text: string): string {
    if (!text) return '';
    const tokens: string[] = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        const ch = text[i];
        if (isCJK(ch)) {
            let end = i;
            while (end < n && isCJK(text[end])) end++;
            const run = text.slice(i, end);
            if (run.length <= 3) {
                tokens.push(run);
            } else {
                for (let s = 0; s <= run.length - 3; s++) {
                    tokens.push(run.slice(s, s + 3));
                }
            }
            i = end;
        } else if (isAsciiWord(ch)) {
            let end = i;
            while (end < n && isAsciiWord(text[end])) end++;
            tokens.push(text.slice(i, end).toLowerCase());
            i = end;
        } else if (isHighSurrogate(ch) && i + 1 < n) {
            // Non-BMP codepoint (emoji, CJK Extension B+ etc.) — emit as a
            // single token. Without this, emoji-only notes get tokenize() = ''
            // and BM25 scores them 0.
            tokens.push(text.slice(i, i + 2));
            i += 2;
        } else {
            i++;
        }
    }
    return tokens.join(' ');
}
