/**
 * Platform detection for mobile/PWA context.
 *
 * Mobile mode = lightweight ingestion (hash + EXIF + thumbs, no faces).
 * Full-size viewing delegates to the platform photo app via Web Share API.
 */

let _isMobile: boolean | null = null;

export function isMobile(): boolean {
    if (_isMobile !== null) return _isMobile;

    // Installed PWA (standalone or fullscreen display mode)
    const isPWA = window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches
        || (navigator as any).standalone === true; // iOS Safari

    // Touch-primary device (not just touch-capable — excludes laptops with touchscreens)
    const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches;

    // Small viewport (phone/tablet portrait)
    const isNarrow = window.matchMedia('(max-width: 768px)').matches;

    _isMobile = isTouchPrimary && (isPWA || isNarrow);
    return _isMobile;
}

/**
 * Share a file via the Web Share API (native share sheet).
 * Returns true if shared, false if API unavailable or user cancelled.
 */
export async function shareFile(file: File): Promise<boolean> {
    if (!navigator.canShare?.({ files: [file] })) return false;
    try {
        await navigator.share({ files: [file] });
        return true;
    } catch (err) {
        // User cancelled — not an error
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        throw err;
    }
}
