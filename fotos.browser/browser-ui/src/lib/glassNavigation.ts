import {APP_BASE, appPathname} from './appBase';

export type GlassView = 'home' | 'gallery' | 'albums' | 'favorites' | 'profile';

export function readGlassView(pathname: string, search: string, base = APP_BASE): GlassView {
    pathname = appPathname(pathname, base);
    const params = new URLSearchParams(search);
    if (pathname.includes('inviteDevice')) return 'profile';
    if (params.get('task') === 'settings' && params.get('view') !== 'gallery') return 'profile';
    if (params.get('task') === 'sharing') return 'gallery';
    const view = params.get('view');
    if (view === 'gallery' || view === 'albums' || view === 'favorites' || view === 'profile') return view;
    if (params.has('photo') || params.has('share') || params.has('fotosShare') || pathname !== '/') return 'gallery';
    return 'home';
}

export function buildGlassViewUrl(href: string, view: GlassView, base = APP_BASE): URL {
    const url = new URL(href);
    url.searchParams.delete('photo');
    url.searchParams.delete('task');
    url.searchParams.delete('album');
    if (view === 'home') {url.searchParams.delete('view'); url.pathname = base;}
    else url.searchParams.set('view', view);
    if (view === 'profile') url.searchParams.set('task', 'settings');
    return url;
}
