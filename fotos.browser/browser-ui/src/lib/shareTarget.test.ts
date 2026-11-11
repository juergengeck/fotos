import { afterEach, expect, it, vi } from 'vitest';
vi.mock('workbox-precaching', () => ({precacheAndRoute: vi.fn(), cleanupOutdatedCaches: vi.fn()}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('receives shared photos under the app scope and redirects into the app', async () => {
    const handlers = new Map<string, (event: any) => void>();
    vi.stubGlobal('self', {__WB_MANIFEST: [], location: {origin: 'https://fotos.one'}, addEventListener: (type: string, handler: any) => handlers.set(type, handler)});
    const stored = new Map<string, Response>();
    vi.stubGlobal('caches', {open: async () => ({keys: async () => [], put: async (key: string, value: Response) => stored.set(key, value)})});
    await import('../sw');
    const form = new FormData();
    form.append('photos', new File(['photo bytes'], 'family.jpg', {type: 'image/jpeg'}));
    let result: Promise<Response> | undefined;
    handlers.get('fetch')!({request: new Request('https://fotos.one/app/_share', {method: 'POST', body: form}), respondWith: (response: Promise<Response>) => {result = response;}});
    const response = await result!;
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('https://fotos.one/app/?share=1');
    expect(await stored.get('/_shared/count')!.text()).toBe('1');
    expect(stored.get('/_shared/0')!.headers.get('X-Filename')).toBe('family.jpg');
    expect(await stored.get('/_shared/0')!.text()).toBe('photo bytes');
});
