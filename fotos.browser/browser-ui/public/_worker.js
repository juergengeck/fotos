const ASSET_EXTENSION_RE = /\.[a-z0-9]+$/i;
const LEGACY_APP_PARAMS = ['fotosShare', 'fotosAccount', 'fotosAcceptAsNew', 'one_token', 'invited', 'invite', 'photo', 'task', 'share', 'view'];

function redirect(url, pathname) {
    url.pathname = pathname;
    return Response.redirect(url.href, 308);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === '/app') return redirect(url, '/app/');
        if (path === '/manifest.webmanifest') return redirect(url, '/app/manifest.webmanifest');
        if (path === '/_share') {
            url.pathname = '/app/_share';
            return Response.redirect(url.href, 307);
        }
        if (path === '/' && LEGACY_APP_PARAMS.some(key => url.searchParams.has(key))) {
            return redirect(url, '/app/');
        }
        if (/^\/(invites\/|faces\/|settings\/?$|gallery\/?$)/.test(path)) {
            return redirect(url, `/app${path}`);
        }
        if (path === '/fotos-id' || path === '/fotos-id.html' || path === '/app/fotos-id.html') {
            return redirect(url, '/app/fotos-id');
        }

        // Only application navigations receive the app shell. Missing assets and
        // unknown marketing URLs must remain real 404s, regardless of Pages' SPA mode.
        const assetPath = path;
        const assetUrl = new URL(url);
        assetUrl.pathname = assetPath;
        let response = await env.ASSETS.fetch(new Request(assetUrl, request));
        const extension = ASSET_EXTENSION_RE.test(path.split('/').pop() ?? '');
        const html = (response.headers.get('content-type') ?? '').includes('text/html');
        const missing = response.status === 404 || (html && path !== '/' && !path.endsWith('.html') && path !== '/app/' && path !== '/app/fotos-id');
        if (missing && path.startsWith('/app/') && !extension && request.method === 'GET') {
            assetUrl.pathname = '/app/';
            response = await env.ASSETS.fetch(new Request(assetUrl, request));
        } else if (missing || (html && extension && !path.endsWith('.html'))) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        }
        return response;
    },
};
