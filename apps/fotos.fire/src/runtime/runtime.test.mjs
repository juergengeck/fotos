import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const compiled = await build({
  stdin: {contents: "export * from './RuntimeController'; export * from './media'; export * from './identity'; export * from './changes';",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts'},
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
});
const {RuntimeController, BlobMediaCache, blobCacheName, projectVerifiedPhotos,
  loadDeviceIdentity, DEVICE_IDENTITY_KEY, classifyFotosArrival} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
function backend(overrides = {}) {
  let listener;
  return {open: async () => {}, close: async () => {}, projectPhotos: async () => [],
    createPairingInvitation: async () => 'https://fotos.one/invite',
    subscribeChanges: callback => { listener = callback; return () => { listener = undefined; }; },
    arrival: (change = 'authorization') => listener?.(change), ...overrides};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const hash = 'a'.repeat(64);

test('first startup persists secure identity before returning; later startup restores exactly it', async () => {
  const saved = new Map();
  const store = {getItemAsync: async key => saved.get(key) ?? null,
    setItemAsync: async (key, value) => { saved.set(key, value); }};
  let generated = 0;
  const random = async size => { generated++; return Uint8Array.from({length: size}, (_, index) => index); };
  const first = await loadDeviceIdentity(store, random);
  assert.equal(JSON.parse(saved.get(DEVICE_IDENTITY_KEY)).secret, first.secret);
  assert.equal(first.secret.length, 64);
  assert.deepEqual(await loadDeviceIdentity(store, random), first);
  assert.equal(generated, 1);
});

test('corrupt persisted identity and secure-store failures never replace identity or open an alternate account', async () => {
  let written = false;
  const store = {getItemAsync: async () => '{"version":1,"secret":"broken"}',
    setItemAsync: async () => { written = true; }};
  await assert.rejects(loadDeviceIdentity(store, async () => { throw new Error('must not regenerate'); }), /saved Fire TV identity is invalid/);
  assert.equal(written, false);
  await assert.rejects(loadDeviceIdentity({...store, getItemAsync: async () => 'private-secret-invalid-json'},
    async () => new Uint8Array()), error => !error.message.includes('private-secret'));
  await assert.rejects(loadDeviceIdentity({getItemAsync: async () => null,
    setItemAsync: async () => { throw new Error('Keystore unavailable'); }}, async n => new Uint8Array(n)), /Keystore unavailable/);
});

test('startup failure is visible; explicit retry closes resources and can recover', async () => {
  let opens = 0;
  let closes = 0;
  const port = backend({open: async () => { if (++opens === 1) throw new Error('Storage locked'); },
    close: async () => { closes++; }});
  const runtime = new RuntimeController(port);
  const states = [];
  runtime.subscribe(snapshot => states.push(snapshot.status));
  await runtime.start();
  assert.equal(runtime.getSnapshot().status, 'error');
  assert.equal(runtime.getSnapshot().error, 'Storage locked');
  await runtime.retry();
  assert.equal(runtime.getSnapshot().status, 'ready');
  assert.equal(closes, 1);
  assert.deepEqual(states.filter((state, index) => index === 0 || state !== states[index - 1]),
    ['starting', 'error', 'starting', 'ready']);
  await runtime.dispose();
});

test('photo arrivals coalesce during projection and a late revocation cannot publish an older result', async () => {
  let calls = 0;
  const oldProjection = deferred();
  const port = backend({projectPhotos: async () => ++calls === 1 ? oldProjection.promise : []});
  const runtime = new RuntimeController(port);
  const snapshots = [];
  runtime.subscribe(snapshot => snapshots.push(snapshot));
  const start = runtime.start();
  await flush();
  port.arrival();
  port.arrival();
  oldProjection.resolve([{id: 'revoked', name: 'Must not appear'}]);
  await start;
  assert.equal(calls, 2);
  assert.equal(snapshots.some(snapshot => snapshot.photos.some(photo => photo.id === 'revoked')), false);
  assert.deepEqual(runtime.getSnapshot().photos, []);
  await runtime.dispose();
});

test('pairing URL is transient and a creation finishing after modal closure stays hidden', async () => {
  const invitation = deferred();
  const runtime = new RuntimeController(backend({createPairingInvitation: () => invitation.promise}));
  await runtime.start();
  const pairing = runtime.createPairingInvitation();
  assert.equal(runtime.getSnapshot().pairingBusy, true);
  runtime.closePairing();
  invitation.resolve('https://fotos.one/invite#private-token');
  await pairing;
  assert.equal(runtime.getSnapshot().pairingUrl, undefined);
  assert.equal(runtime.getSnapshot().pairingBusy, false);
  await runtime.dispose();
});

test('projection failures clear photos visibly and a later arrival may re-evaluate the state', async () => {
  let broken = false;
  const port = backend({projectPhotos: async () => {
    if (broken) throw new Error('Signature verification failed');
    return [{id: 'one', name: 'Shared'}];
  }});
  const runtime = new RuntimeController(port);
  await runtime.start();
  broken = true;
  port.arrival();
  await flush();
  assert.equal(runtime.getSnapshot().status, 'error');
  assert.equal(runtime.getSnapshot().error, 'Signature verification failed');
  assert.deepEqual(runtime.getSnapshot().photos, []);
  broken = false;
  port.arrival();
  await flush();
  assert.equal(runtime.getSnapshot().status, 'ready');
  await runtime.dispose();
});

test('native media cache uses content-addressed paths and missing bytes are retried only by caller after arrival', async () => {
  const files = new Map();
  let arrived = false;
  let reads = 0;
  const cache = new BlobMediaCache({exists: name => files.has(name),
    write: (name, bytes) => { files.set(name, bytes); }, uri: name => `file:///app/cache/${name}`},
  async () => { reads++; if (!arrived) throw Object.assign(new Error('Missing bytes'), {name: 'FileNotFoundError'});
    return Uint8Array.from([1, 2, 3]).buffer; });
  assert.equal(await cache.resolve(hash, 'image/jpeg'), undefined);
  await flush();
  assert.equal(reads, 1);
  arrived = true;
  assert.equal(await cache.resolve(hash, 'image/jpeg'), `file:///app/cache/${hash}.jpg`);
  assert.equal(await cache.resolve(hash, 'image/jpeg'), `file:///app/cache/${hash}.jpg`);
  assert.equal(reads, 2);
  assert.deepEqual([...files.get(`${hash}.jpg`)], [1, 2, 3]);
  assert.throws(() => blobCacheName('../outside', 'image/jpeg'), /Invalid/);
  const failed = new BlobMediaCache({exists: () => false}, async () => { throw new Error('Decryption failed'); });
  await assert.rejects(failed.resolve(hash, 'image/jpeg'), /Decryption failed/);
});

test('only active verified scopes reach native media and desktop source paths never become URIs', async () => {
  const entry = {$type$: 'FotosEntry', contentHash: hash, streamId: 's', mime: 'image/jpeg', size: 4,
    sourcePath: '/Users/sender/private/image.jpg', thumb: 'b'.repeat(64), variants: new Set(['preview'])};
  const scopes = [
    {status: 'active', verified: false, entries: [{...entry, contentHash: 'unverified'}]},
    {status: 'revoked', verified: true, entries: [{...entry, contentHash: 'revoked'}]},
    {status: 'active', verified: true, entries: [entry]},
  ];
  const requested = [];
  const photos = await projectVerifiedPhotos(scopes, {
    entryId: async value => value.contentHash,
    getVariant: async () => ({$type$: 'FotosMediaVariant', family: hash, role: 'preview', mime: 'image/webp', blob: 'c'.repeat(64)}),
    mediaUri: async (blob, mime) => { requested.push(blob); return `file:///cache/${blobCacheName(blob, mime)}`; },
  });
  assert.equal(photos.length, 1);
  assert.equal(photos[0].id, hash);
  assert.equal(photos[0].name, 'image.jpg');
  assert.match(photos[0].mediaUri, /^file:\/\/\/cache\/c+\.webp$/);
  assert.equal(JSON.stringify(photos).includes('/Users/sender'), false);
  assert.deepEqual(requested, ['b'.repeat(64), 'c'.repeat(64)]);
});

test('metadata remains present when referenced variants or blobs have not arrived', async () => {
  const photos = await projectVerifiedPhotos([{status: 'active', verified: true, entries: [
    {$type$: 'FotosEntry', contentHash: hash, streamId: 's', mime: 'image/jpeg', size: 4, variants: new Set(['late'])},
  ]}], {entryId: async () => hash, getVariant: async () => { throw Object.assign(new Error('late'), {name: 'FileNotFoundError'}); },
    mediaUri: async () => undefined});
  assert.equal(photos.length, 1);
  assert.equal(photos[0].mediaUri, undefined);
  assert.equal(photos[0].thumbnailUri, undefined);
});


test('concurrent retry actions share one restart and dispose retires pending pairing work', async () => {
  let opens = 0;
  let closes = 0;
  const closing = deferred();
  const invitation = deferred();
  const runtime = new RuntimeController(backend({open: async () => { opens++; },
    close: async () => { closes++; if (closes === 1) await closing.promise; },
    createPairingInvitation: () => invitation.promise}));
  await runtime.start();
  const pairing = runtime.createPairingInvitation();
  const first = runtime.retry();
  const second = runtime.retry();
  assert.equal(first, second);
  await flush();
  assert.equal(closes, 1);
  closing.resolve();
  await first;
  assert.equal(opens, 2);
  invitation.resolve('https://fotos.one/retired');
  await pairing;
  assert.equal(runtime.getSnapshot().pairingUrl, undefined);
  const disposal = runtime.dispose();
  assert.equal(runtime.dispose(), disposal);
  await disposal;
  assert.equal(closes, 2);
});


test('authorization evidence clears the old fullscreen photo synchronously while the new projection is unresolved', async () => {
  const pending = deferred();
  let projections = 0;
  const revoked = {id: 'revoked-photo', name: 'Previously shared', mediaUri: 'file:///cache/revoked.jpg'};
  const port = backend({projectPhotos: async () => ++projections === 1 ? [revoked] : pending.promise});
  const runtime = new RuntimeController(port);
  await runtime.start();
  assert.equal(runtime.getSnapshot().photos[0].id, revoked.id);
  port.arrival('authorization');
  // Do not resolve the projection: the already displayed photo must disappear
  // in the arrival callback, before verification or native blob reads finish.
  assert.equal(runtime.getSnapshot().status, 'starting');
  assert.deepEqual(runtime.getSnapshot().photos, []);
  await flush();
  assert.deepEqual(runtime.getSnapshot().photos, []);
  pending.resolve([]);
  await flush();
  assert.equal(runtime.getSnapshot().status, 'ready');
  assert.deepEqual(runtime.getSnapshot().photos, []);
  await runtime.dispose();
});

test('blob-only arrivals retain the authorized gallery while native materialization is unresolved', async () => {
  const pending = deferred();
  let projections = 0;
  const authorized = {id: 'allowed-photo', name: 'Still shared', thumbnailUri: 'file:///cache/thumb.jpg'};
  const port = backend({projectPhotos: async () => ++projections === 1 ? [authorized] : pending.promise});
  const runtime = new RuntimeController(port);
  await runtime.start();
  port.arrival('media');
  assert.equal(runtime.getSnapshot().status, 'ready');
  assert.deepEqual(runtime.getSnapshot().photos, [authorized]);
  await flush();
  assert.deepEqual(runtime.getSnapshot().photos, [authorized]);
  pending.resolve([{...authorized, mediaUri: 'file:///cache/preview.jpg'}]);
  await flush();
  assert.equal(runtime.getSnapshot().photos[0].mediaUri, 'file:///cache/preview.jpg');
  await runtime.dispose();
});

test('native arrivals distinguish authorization evidence from blob and variant materialization', () => {
  for (const type of ['FotosShareCertificate', 'FotosShareCertificateChain', 'FotosShareManifest',
    'Signature', 'Profile', 'Someone', 'Keys', 'TrustKeysCertificate']) {
    assert.equal(classifyFotosArrival({kind: 'object', type}), 'authorization');
  }
  assert.equal(classifyFotosArrival({kind: 'blob', type: 'BLOB'}), 'media');
  assert.equal(classifyFotosArrival({kind: 'object', type: 'FotosMediaVariant'}), 'media');
  assert.equal(classifyFotosArrival({kind: 'object', type: 'FotosEntry'}), 'media');
  assert.equal(classifyFotosArrival({kind: 'object', type: 'Unrelated'}), undefined);
});
