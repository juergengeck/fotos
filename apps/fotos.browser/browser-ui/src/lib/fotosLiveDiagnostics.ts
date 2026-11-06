function normalizeDebugFlag(input: string | null): boolean {
    if (!input) {
        return false;
    }

    const normalized = input.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function shouldExposeFotosDebugApi(isDev: boolean, search: string): boolean {
    if (isDev) {
        return true;
    }

    const params = new URLSearchParams(search);
    return normalizeDebugFlag(params.get('fotosDebug'));
}
