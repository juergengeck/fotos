import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import worker from '../../public/_worker.js';

const root = fileURLToPath(new URL('../../../_deploy/', import.meta.url));
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm'};
const env = {ASSETS: {async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname === '/app/' ? '/app/index.html' : url.pathname === '/app/fotos-id' ? '/app/fotos-id.html' : url.pathname}`);
    if (!path.startsWith(root)) return new Response('Not Found', {status: 404});
    try { return new Response(await readFile(path), {headers: {'Content-Type': types[extname(path)] || 'application/octet-stream'}}); }
    catch { return new Response('Not Found', {status: 404}); }
}}};
const server = createServer(async (req, res) => {
    try {
        const response = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, {method: req.method}), env);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = (process.env.FOTOS_SITE_URL || `http://127.0.0.1:${server.address().port}`).replace(/\/$/, '');
const browser = await chromium.launch({headless: true});
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    assert.match(await page.title(), /we do not want your fotos/);
    assert.equal(await page.locator('#cta-link').getAttribute('href'), '/app/');
    assert.equal((await page.locator('#cta-link').textContent()).trim(), 'Open Fotos');
    assert.match(await page.locator('.description').textContent(), /private photo library that runs in your browser/);
    const screenshots = process.env.FOTOS_SITE_SCREENSHOTS;
    if (screenshots) {
        await mkdir(screenshots, {recursive: true});
        await page.screenshot({path: resolve(screenshots, 'marketing-desktop.png'), fullPage: true, animations: 'disabled'});
    }
    assert.equal(await page.locator('script[src^="/app/"]').count(), 0);
    await page.locator('#cta-link').click();
    await page.getByRole('heading', {name: 'Open your photo library'}).waitFor({timeout: 30_000});
    assert.equal(new URL(page.url()).pathname, '/app/');
    assert.equal(await page.getByRole('heading', {name: 'Photo library', exact: true}).count(), 1);
    assert.equal(await page.getByRole('link', {name: 'About Fotos'}).getAttribute('href'), '/');
    assert.equal(await page.getByRole('button', {name: 'Open Photo Folder'}).count(), 1);
    if (screenshots) await page.screenshot({path: resolve(screenshots, 'app-desktop.png'), fullPage: true, animations: 'disabled'});
    await page.setViewportSize({width: 390, height: 844});
    assert.ok(await page.getByRole('button', {name: 'Open Photo Folder'}).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (screenshots) await page.screenshot({path: resolve(screenshots, 'app-mobile.png'), fullPage: true, animations: 'disabled'});
    await page.goto(origin);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (screenshots) await page.screenshot({path: resolve(screenshots, 'marketing-mobile.png'), fullPage: true, animations: 'disabled'});
    await page.locator('#cta-link').click();
    await page.getByRole('heading', {name: 'Open your photo library'}).waitFor();
    const scope = await page.evaluate(async () => (await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker registration timed out')), 20000))])).scope);
    assert.equal(scope, `${origin}/app/`);
    const manifest = await (await fetch(`${origin}/app/manifest.webmanifest`)).json();
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, '/app/');
    assert.equal(manifest.scope, '/app/');
    assert.equal(manifest.share_target.action, '/app/_share');
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/app/sw.js'));
    const shared = await page.evaluate(async () => {
        const form = new FormData();
        form.append('photos', new File(['site split verification'], 'split-check.png', {type: 'image/png'}));
        await fetch('/app/_share', {method: 'POST', body: form, redirect: 'manual'});
        const cache = await caches.open('fotos-share');
        const count = await (await cache.match('/_shared/count'))?.text();
        const photo = await cache.match('/_shared/0');
        const result = {count, filename: photo?.headers.get('X-Filename'), body: await photo?.text()};
        await caches.delete('fotos-share');
        return result;
    });
    assert.deepEqual(shared, {count: '1', filename: 'split-check.png', body: 'site split verification'});

    for (const path of ['/app/invites/inviteDevice', '/app/faces/person']) {
        const response = await fetch(origin + path);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /\/app\/assets\/main-/);
    }
    assert.equal((await fetch(`${origin}/app/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${origin}/unknown`)).status, 404);
    await page.goto(`${origin}/app/fotos-id`);
    await page.locator('#root').filter({hasText: /.+/}).waitFor({timeout: 10_000});
    assert.match(await page.title(), /fotos id/);
    await page.goto(origin);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), null);
    assert.deepEqual(errors, []);
    console.log('PASS: marketing/app navigation, deep links, recovery popup, manifest, live share upload, service-worker isolation and missing assets');
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
