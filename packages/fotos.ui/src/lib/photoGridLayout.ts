/** Fit up to eight results, including their date headers, into the gallery viewport. */
export function fitSparsePhotoSize(counts: number[], width: number, height: number, preferred: number): number {
    const usableWidth = Math.max(0, width - 8);
    const usableHeight = Math.max(0, height - counts.length * 32);
    if (!usableWidth || !usableHeight) return Math.min(preferred, usableWidth || preferred);
    const total = counts.reduce((sum, count) => sum + count, 0);
    let best = 0;
    for (let columns = 1; columns <= total; columns++) {
        const rows = counts.reduce((sum, count) => sum + Math.ceil(count / columns), 0);
        const size = Math.min(
            (usableWidth - (columns - 1) * 4) / columns,
            (usableHeight - (rows - 1) * 4) / rows,
        );
        best = Math.max(best, size);
    }
    // Manual size remains the baseline; small viewports must never overflow horizontally.
    return Math.max(1, Math.min(usableWidth, Math.max(preferred, Math.floor(best))));
}
