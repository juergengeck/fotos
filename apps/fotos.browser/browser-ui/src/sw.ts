/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Precache static assets injected by vite-plugin-pwa
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Take control of already-open clients once a waiting worker is promoted.
self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(self.clients.claim());
});

// ── Share Target: intercept POST to /_share ──────────────────────────
self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);
    if (url.pathname === '/_share' && event.request.method === 'POST') {
        event.respondWith(handleShareTarget(event));
    }
});

async function handleShareTarget(event: FetchEvent): Promise<Response> {
    const formData = await event.request.formData();
    const files = formData.getAll('photos') as File[];

    if (files.length > 0) {
        const cache = await caches.open('fotos-share');
        // Clear previous share
        const existing = await cache.keys();
        await Promise.all(existing.map(k => cache.delete(k)));
        // Stash each file keyed by index
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const response = new Response(file, {
                headers: {
                    'Content-Type': file.type,
                    'X-Filename': file.name,
                    'X-Size': String(file.size),
                },
            });
            await cache.put(`/_shared/${i}`, response);
        }
        await cache.put('/_shared/count', new Response(String(files.length)));
    }

    return Response.redirect('/?share=1', 303);
}

// Skip waiting when told by the app
self.addEventListener('message', (event: ExtendableMessageEvent) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
