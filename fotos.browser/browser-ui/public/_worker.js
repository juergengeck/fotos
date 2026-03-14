const ASSET_EXTENSION_RE = /\.[a-z0-9]+$/i;

function isAssetLikeRequest(url) {
    const { pathname } = url;

    if (pathname === "/sw.js" || pathname.startsWith("/workbox-")) {
        return true;
    }

    if (pathname.startsWith("/assets/") || pathname.startsWith("/ort/")) {
        return true;
    }

    const lastSegment = pathname.split("/").pop() ?? "";
    if (!ASSET_EXTENSION_RE.test(lastSegment)) {
        return false;
    }

    return !lastSegment.endsWith(".html") && !lastSegment.endsWith(".htm");
}

function isHtmlResponse(response) {
    return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const assetLikeRequest = isAssetLikeRequest(url);
        const response = await env.ASSETS.fetch(request);

        // Pages' default SPA mode rewrites missing assets to /index.html. That is fine
        // for navigations, but it breaks module scripts because the browser receives
        // HTML for a JavaScript URL. Convert those fallbacks into real 404s instead.
        if (assetLikeRequest && response.ok && isHtmlResponse(response)) {
            return new Response("Not Found", {
                status: 404,
                headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate",
                    "Content-Type": "text/plain; charset=utf-8",
                    "X-Robots-Tag": "noindex",
                },
            });
        }

        return response;
    },
};
