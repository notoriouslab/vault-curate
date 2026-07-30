/**
 * k-NN Graph Worker (014 D1-D4) — owns the O(N²) full build so the main
 * thread never freezes. Pure math: no Obsidian API, no network, no WASM,
 * no model — the build MUST keep it that way (esbuild.config.mjs asserts
 * the bundle contains no "obsidian" string).
 *
 * Protocol:
 *   main → worker  {type:'knn-build', matrixBuffer, dim, paths, k, sameFolderCap}
 *                   (matrixBuffer arrives transferred — zero copy)
 *   worker → main  {type:'knn-progress', done, total}       every 256 rows
 *   worker → main  {type:'knn-done', pickCounts, pickTargets, pickSims, matrixBuffer}
 *                   (ALL buffers transferred back — D4 two-leg relay: the
 *                    matrix returns to become the resident incremental state)
 *   worker → main  {type:'knn-error', message}
 *
 * The picks come from the SAME buildKnnPicks the sync fallback uses (D2
 * single source of truth), and sims travel as f64 — worker results are
 * bit-identical to a main-thread build.
 */

import { buildKnnPicks } from '../search/semanticPath';
import { packPicks } from '../search/knnCodec';

const ctx = self as unknown as {
    postMessage: (data: unknown, transfer?: Transferable[]) => void;
    onmessage: ((event: MessageEvent) => void) | null;
};

export type KnnBuildMsg = {
    type: 'knn-build';
    matrixBuffer: ArrayBuffer;
    dim: number;
    paths: string[];
    k: number;
    sameFolderCap: number;
};

ctx.onmessage = (event: MessageEvent) => {
    const msg = event.data as KnnBuildMsg;
    if (!msg || msg.type !== 'knn-build') return;
    try {
        const matrix = new Float32Array(msg.matrixBuffer);
        const notes: Array<{ path: string; vec: Float32Array }> = [];
        for (let i = 0; i < msg.paths.length; i++) {
            notes.push({
                path: msg.paths[i],
                vec: matrix.subarray(i * msg.dim, (i + 1) * msg.dim),
            });
        }
        const picks = buildKnnPicks(notes, msg.k, msg.sameFolderCap, (done, total) => {
            ctx.postMessage({ type: 'knn-progress', done, total });
        });
        const pathIndex = new Map(msg.paths.map((p, i) => [p, i]));
        const packed = packPicks(picks, msg.paths, pathIndex);
        ctx.postMessage(
            {
                type: 'knn-done',
                pickCounts: packed.pickCounts,
                pickTargets: packed.pickTargets,
                pickSims: packed.pickSims,
                matrixBuffer: msg.matrixBuffer,
            },
            [
                packed.pickCounts.buffer,
                packed.pickTargets.buffer,
                packed.pickSims.buffer,
                msg.matrixBuffer,
            ],
        );
    } catch (e) {
        ctx.postMessage({
            type: 'knn-error',
            message: e instanceof Error ? e.message : String(e),
        });
    }
};
