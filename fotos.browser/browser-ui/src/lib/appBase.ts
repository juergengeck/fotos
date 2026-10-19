export const APP_BASE = import.meta.env.BASE_URL || '/';

export function appPath(path = '', base = APP_BASE): string {
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function appPathname(pathname: string, base = APP_BASE): string {
    const prefix = base.replace(/\/$/, '');
    if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        return pathname.slice(prefix.length) || '/';
    }
    return pathname;
}

export const SHARE_TARGET_CACHE = APP_BASE === '/' ? 'fotos-share' : `fotos-share:${APP_BASE}`;
