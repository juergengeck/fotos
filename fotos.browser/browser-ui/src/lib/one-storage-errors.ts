/** A versioned object or blob that has not reached this instance (yet). */
export function isMissingVersionedObject(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const name = String((error as {name?: unknown}).name ?? '');
    const message = String((error as {message?: unknown}).message ?? '').toLowerCase();
    return name === 'FileNotFoundError'
        || message.includes('not found')
        || message.includes('sb-read2');
}
