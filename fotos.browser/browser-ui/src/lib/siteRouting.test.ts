import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Cloudflare worker is a JavaScript deployment entry point.
import worker from '../../public/_worker.js';

function assets() {
    return { fetch: vi.fn(async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path === '/') return new Response('marketing', {headers: {'Content-Type': 'text/html'}});
        if (path === '/app/') return new Response('app', {headers: {'Content-Type': 'text/html'}});
        if (path === '/app/fotos-id') return new Response('recovery', {headers: {'Content-Type': 'text/html'}});
        return new Response('missing', {status: 404});
    }) };
}
const fetchSite = (path: string) => worker.fetch(new Request(`https://fotos.one${path}`), {ASSETS: assets()});

describe('marketing and app deployment routing', () => {
    it('serves separate marketing, app, popup and deep-link documents', async () => {
        for (const [path, body] of [['/', 'marketing'], ['/app/', 'app'], ['/app/faces/a', 'app'], ['/app/invites/inviteDevice', 'app'], ['/app/fotos-id', 'recovery']]) {
            expect(await (await fetchSite(path)).text()).toBe(body);
        }
    });
    it('canonicalizes the app mount and preserves old link parameters', async () => {
        for (const [path, destination] of [['/app?photo=a', '/app/?photo=a'], ['/?fotosShare=abc', '/app/?fotosShare=abc'], ['/invites/inviteDevice?invited=true', '/app/invites/inviteDevice?invited=true'], ['/fotos-id', '/app/fotos-id']]) {
            const response = await fetchSite(path);
            expect(response.status).toBe(308);
            expect(response.headers.get('Location')).toBe(`https://fotos.one${destination}`);
        }
    });
    it('moves legacy PWA metadata and preserves POST sharing on redirect', async () => {
        expect((await fetchSite('/manifest.webmanifest')).headers.get('Location')).toBe('https://fotos.one/app/manifest.webmanifest');
        const response = await worker.fetch(new Request('https://fotos.one/_share', {method: 'POST', body: 'photos'}), {ASSETS: assets()});
        expect(response.status).toBe(307);
        expect(response.headers.get('Location')).toBe('https://fotos.one/app/_share');
    });
    it('keeps missing assets and unknown marketing paths as 404s', async () => {
        for (const path of ['/app/assets/missing.js', '/app/ort/missing.wasm', '/app/missing.html', '/unknown']) {
            expect((await fetchSite(path)).status).toBe(404);
        }
    });
    it('rejects HTML returned by a hosting SPA fallback for missing modules', async () => {
        const response = await worker.fetch(new Request('https://fotos.one/app/assets/missing.js'), {
            ASSETS: {fetch: async () => new Response('marketing', {headers: {'Content-Type': 'text/html'}})},
        });
        expect(response.status).toBe(404);
    });
});
