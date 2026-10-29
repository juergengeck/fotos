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
 * Returns whether the runtime can share the provided files via the native
 * share sheet.
 */
export function canShareFiles(files: readonly File[]): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
        return false;
    }

    if (files.length === 0) {
        return false;
    }

    if (typeof navigator.canShare !== 'function') {
        return files.length === 1;
    }

    try {
        return navigator.canShare({ files: [...files] });
    } catch {
        return false;
    }
}

/**
 * Share files via the Web Share API (native share sheet).
 * Returns true if shared, false if API unavailable or user cancelled.
 */
export async function shareFiles(files: readonly File[]): Promise<boolean> {
    if (!canShareFiles(files)) return false;
    try {
        await navigator.share({ files: [...files] });
        return true;
    } catch (err) {
        // User cancelled — not an error
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        throw err;
    }
}

/**
 * Share a single file via the Web Share API (native share sheet).
 * Returns true if shared, false if API unavailable or user cancelled.
 */
export async function shareFile(file: File): Promise<boolean> {
    return shareFiles([file]);
}
