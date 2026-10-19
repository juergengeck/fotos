import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync, gunzipSync} from 'node:zlib';
import worker from './konrad-worker.mjs';

const request = path => new Request(`https://fotos.one${path}`);
test('redirects only the exact prefix to its directory', async () => {
    const response = await worker.fetch(request('/konrad?view=albums'), {});
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), 'https://fotos.one/konrad/?view=albums');
});
test('serves the SPA for deep links and the separate account popup', async () => {
    const paths = [];
    const env = {ASSETS: {fetch: async req => {
        const path = new URL(req.url).pathname;
        paths.push(path);
        return path.endsWith('.html') ? new Response('<html>Fotos</html>', {headers: {'Content-Type': 'text/html'}}) : new Response('missing', {status: 404});
    }}};
    const response = await worker.fetch(request('/konrad/invites/inviteDevice?invited=true'), env);
    assert.equal(response.status, 200);
    assert.equal(paths.at(-1), '/konrad/index.html');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await worker.fetch(request('/konrad/fotos-id?mode=recover'), env);
    assert.equal(paths.at(-1), '/konrad/fotos-id.html');
});
test('preserves missing asset 404s instead of returning HTML', async () => {
    let count = 0;
    const response = await worker.fetch(request('/konrad/assets/missing.js'), {ASSETS: {fetch: async () => {count++; return new Response('missing', {status: 404});}}});
    assert.equal(response.status, 404);
    assert.equal(count, 1);
});
test('serves compressed oversized runtimes at their original WASM URL', async () => {
    const source = Buffer.from('WASM fixture');
    const env = {ASSETS: {fetch: async req => new URL(req.url).pathname.endsWith('.gz') ? new Response(gzipSync(source)) : new Response('missing', {status: 404})}};
    const response = await worker.fetch(request('/konrad/assets/runtime.wasm'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/wasm');
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.deepEqual(gunzipSync(Buffer.from(await response.arrayBuffer())), source);
});
