/**
 * Canvas edge labels show similarity with two decimals. A non-finite score
 * (NaN from a zero vector, ±Infinity from a corrupt blob) would otherwise
 * render as the literal "NaN" on the canvas — show a dash instead.
 */
export function formatScore(n: number): string {
    return Number.isFinite(n) ? n.toFixed(2) : "–";
}
