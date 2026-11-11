// One-time migration from the former root-scoped PWA. Keep user storage intact.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await self.registration.unregister();
        const clients = await self.clients.matchAll({type: 'window'});
        await Promise.all(clients.map(client => {
            const url = new URL(client.url);
            if (!url.pathname.startsWith('/app/')) {
                url.pathname = url.pathname === '/' ? '/app/' : `/app${url.pathname}`;
                return client.navigate(url.href);
            }
        }));
    })());
});
