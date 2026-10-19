const PREFIX = '/konrad';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === PREFIX) {
            url.pathname += '/';
            return Response.redirect(url.href, 308);
        }
        // The route wildcard also matches /konrad-other. Leave those to the origin.
        if (!url.pathname.startsWith(`${PREFIX}/`)) return fetch(request);
        if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', {status: 405});

        let response = await env.ASSETS.fetch(request);
        // Keep oversized WASM runtimes available within Cloudflare's per-file limit.
        // The browser decodes this gzip response before WebAssembly compilation.
        if (response.status === 404 && url.pathname.endsWith('.wasm')) {
            const compressed = new URL(url);
            compressed.pathname += '.gz';
            const packed = await env.ASSETS.fetch(new Request(compressed, request));
            if (packed.ok) {
                const headers = new Headers(packed.headers);
                headers.set('Content-Type', 'application/wasm');
                headers.set('Content-Encoding', 'gzip');
                headers.set('Cache-Control', 'public, max-age=31536000, immutable');
                return new Response(packed.body, {status: packed.status, headers});
            }
        }

        // Extensionless routes belong to the app; missing assets must stay 404s.
        if (response.status === 404 && !/\.[a-z0-9]+$/i.test(url.pathname.split('/').pop() ?? '')) {
            url.pathname = url.pathname.replace(/\/$/, '') === `${PREFIX}/fotos-id`
                ? `${PREFIX}/fotos-id.html` : `${PREFIX}/index.html`;
            response = await env.ASSETS.fetch(new Request(url, request));
        }
        const headers = new Headers(response.headers);
        if ((headers.get('Content-Type') ?? '').includes('text/html') || /\/(sw\.js|version\.json|manifest\.webmanifest)$/.test(new URL(request.url).pathname)) {
            headers.set('Cache-Control', 'no-store');
        }
        return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
    },
};
