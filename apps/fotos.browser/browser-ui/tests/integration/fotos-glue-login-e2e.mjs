/** Real Fotos UI + registrar + WebAuthn. Only transport routing is local.
 * The registrar must use disposable storage; never point this at production.
 * Run with run-fotos-glue-login.mjs, which supplies an isolated registrar via
 * FOTOS_GLUE_QA_STATE (base, debug token, artifact directory).
 */
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign, randomUUID} from 'node:crypto';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {subscriptionCertificateSigningPayload} from '@refinio/trust.core/recipes/SubscriptionCertificate.js';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));
assert.ok(process.env.FOTOS_GLUE_QA_STATE, 'Run through run-fotos-glue-login.mjs');
const state = JSON.parse(readFileSync(process.env.FOTOS_GLUE_QA_STATE, 'utf8'));
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(state.base).hostname), 'Use a disposable local registrar');
const appUrl = process.env.FOTOS_GLUE_QA_URL || 'http://localhost:5397/';
const mode = process.env.FOTOS_GLUE_QA_MODE || 'popup';
assert.ok(['popup', 'redirect'].includes(mode));
const artifacts = resolve(state.dir, `browser-${mode}`);
mkdirSync(artifacts, {recursive: true});
const results = [];
const network = [];
let browser;
let context;
let page;
let phase = 'setup';
let transportMode = 'normal';

async function step(name, run) {
  phase = name;
  console.log(`[fotos-glue-e2e] ${name}`);
  const started = Date.now();
  try {
    const detail = await run();
    results.push({name, status: 'passed', durationMs: Date.now() - started, detail});
    return detail;
  } catch (error) {
    results.push({name, status: 'failed', durationMs: Date.now() - started, error: String(error)});
    throw error;
  }
}
async function post(path, body) {
  const response = await fetch(state.base + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const json = await response.json();
  assert.equal(json.success, true, `${path} (${response.status}): ${json.error}`);
  return json.data;
}
async function ready() {
  await page.waitForFunction(() => window.__fotosDebug?.getStatus().initialized, undefined, {timeout: 90_000});
}
async function account() {
  return page.evaluate(() => ({
    active: localStorage.getItem('fotos_active_account'),
    sessionActive: sessionStorage.getItem('fotos_active_account_session'),
    entries: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('fotos_'))),
  }));
}
let credential;
let owner;
let fixture;
const authenticatorReady = new WeakMap();
async function attachAuthenticator(target) {
  const session = await context.newCDPSession(target);
  await session.send('WebAuthn.enable');
  const {authenticatorId} = await session.send('WebAuthn.addVirtualAuthenticator', {options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  }});
  if (credential) {
    // Each popup represents the same device. Keep its authenticator counter
    // monotonic when cloning the test device into a fresh target.
    credential = {...credential, signCount: credential.signCount + 10};
    await session.send('WebAuthn.addCredential', {authenticatorId, credential});
  }
  return {session, authenticatorId};
}
async function assertNoWebStorageSecret() {
  const absent = await page.evaluate(async ({subject, moduleUrl}) => {
    const {createBrowserCredentialVault} = await import(moduleUrl);
    const secret = await createBrowserCredentialVault().read('https://glue.one', subject);
    const storage = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
    return Boolean(secret) && !storage.includes(secret);
  }, {subject: fixture.subject, moduleUrl: '/@fs/' + resolve(root, 'sources/one/packages/auth.core/dist/index.js')});
  assert.equal(absent, true, 'The exact sealed credential must be absent from both Web Storage areas');
}

try {
  browser = await chromium.launch({headless: process.env.HEADLESS !== 'false'});
  context = await browser.newContext({viewport: {width: 1440, height: 900}, serviceWorkers: 'block'});
  if (mode === 'redirect') {
    // Exercise the product's full-page fallback with popups blocked.
    await context.addInitScript(origin => {if (location.origin === origin) window.open = () => null;}, new URL(appUrl).origin);
  }
  context.on('page', target => authenticatorReady.set(target, attachAuthenticator(target)));
  const consentHtml = readFileSync(resolve(root, '../glue/glue.browser/browser-ui/public/one-auth.html'), 'utf8');
  await context.route('https://glue.one/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__fotos_e2e_enroll') return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated passkey enrollment</title>'});
    assert.ok(['/one-auth', '/one-auth.html'].includes(url.pathname), 'Unexpected Glue document');
    await route.fulfill({contentType: 'text/html', body: consentHtml});
  });
  await context.route('https://api.glue.one/**', async route => {
    // Popup navigation precedes its Frame object. API subrequests have a frame
    // and wait for that page's real virtual device before beginning WebAuthn.
    await authenticatorReady.get(route.request().frame().page());
    const url = new URL(route.request().url());
    if (transportMode === 'cancel' && url.pathname === '/api/auth/passkey/begin') return route.abort('aborted');
    const response = await route.fetch({url: state.base + url.pathname + url.search});
    network.push({phase, method: route.request().method(), path: url.pathname, status: response.status()});
    if (transportMode === 'tamper' && url.pathname === '/api/fedcm/assertion' && response.status() === 200) {
      const body = await response.json();
      const token = JSON.parse(body.token);
      token.signature = '00'.repeat(64);
      return route.fulfill({response, json: {...body, token: JSON.stringify(token)}});
    }
    await route.fulfill({response});
  });
  page = await context.newPage();
  await step('Enroll a real resident passkey in the isolated registrar', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const name = `fotosqa${suffix}`;
    const identity = `${name}@glue.one`;
    const subject = createHash('sha256').update(`fotos-glue-e2e:${suffix}`).digest('hex');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('hex');
    const now = Date.now();
    const cert = {$type$: 'SubscriptionCertificate', id: identity, certificateType: 'identity', status: 'valid',
      subject, subjectPublicKey: publicKey, issuer: subject, issuerPublicKey: publicKey,
      validFrom: now, validUntil: now + 86_400_000, chainDepth: 0, issuedAt: now, serialNumber: suffix,
      signatureScheme: 'one-canonical-v1', claims: {identity, domain: 'glue.one', localPart: name,
        tier: 'debug', priceEur: 0, subscriptionStatus: 'preliminary', paymentId: '', depositAmount: 0,
        autoRenew: false, service: 'Identity attestation and verification'}};
    cert.signature = sign(null, Buffer.from(subscriptionCertificateSigningPayload(cert)), pair.privateKey).toString('hex');
    await post('/api/registration/debug/registerName', {token: state.token, cert, ttlMs: 1_800_000});
    const signature = sign(null, Buffer.from(`passkey-register:${identity}`), pair.privateKey).toString('hex');
    const begin = await post('/api/registration/passkey/register-begin', {name, publicKey, signature});
    await page.goto('https://glue.one/__fotos_e2e_enroll');
    const attestation = await page.evaluate(async options => {
      const created = await navigator.credentials.create({publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options)});
      return created.toJSON();
    }, begin.options);
    await post('/api/registration/passkey/register-complete', {name, challengeId: begin.challengeId, attestation});
    const {session, authenticatorId} = await authenticatorReady.get(page);
    const credentials = await session.send('WebAuthn.getCredentials', {authenticatorId});
    assert.equal(credentials.credentials.length, 1);
    credential = credentials.credentials[0];
    fixture = {name, subject};
    return {subject, realWebAuthnAttestation: true};
  });
  await step('Open Fotos and find Glue directly beside the login field', async () => {
    await page.goto(appUrl); await ready();
    const fixtureBytes = [...readFileSync(resolve(root, 'apps/fotos.browser/browser-ui/src/lib/__fixtures__/photos/rose-detail.png'))];
    await page.evaluate(async bytes => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('fotos-glue-e2e-library', {create: true});
      const file = await directory.getFileHandle('proof.png', {create: true});
      const writer = await file.createWritable(); await writer.write(new Uint8Array(bytes)); await writer.close();
      window.showDirectoryPicker = async () => directory;
    }, fixtureBytes);
    await page.getByRole('button', {name: 'Open Photo Folder'}).click();
    await page.getByRole('searchbox', {name: 'Search photos'}).waitFor({timeout: 90_000});
    await page.getByRole('button', {name: 'settings', exact: true}).click();
    if (!await page.locator('#fotos-login').isVisible()) await page.getByText('fotos id', {exact: true}).click();
    await page.locator('#fotos-login').waitFor();
    assert.equal(await page.locator('#fotos-login').evaluate(input => Boolean(input.parentElement.querySelector('button[aria-label="Sign in with glue.one"]'))), true);
    await page.locator('#fotos-login').fill(fixture.name);
    await page.screenshot({path: resolve(artifacts, 'login-field.png')});
    owner = await page.evaluate(() => window.__fotosDebug.getLocalIdentitySnapshot());
    return {visitorOwner: owner.ownerId, besideField: true};
  });
  if (mode === 'popup') await step('Cancel Glue without switching or losing the visitor account', async () => {
    const before = await account();
    transportMode = 'cancel';
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', {name: 'Sign in with glue.one'}).click();
    const popup = await popupPromise;
    const closed = popup.waitForEvent('close');
    await page.getByRole('button', {name: 'Cancel sign-in', exact: true}).click();
    await closed;
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Sign in with glue.one"]').disabled);
    assert.deepEqual(await account(), before);
    transportMode = 'normal';
    return {visitorPreserved: true};
  });
  if (mode === 'popup') await step('Reject a tampered registrar assertion without creating a Glue account', async () => {
    const before = await account();
    transportMode = 'tamper';
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', {name: 'Sign in with glue.one'}).click();
    await popupPromise;
    await page.getByRole('alert').filter({hasText: 'Invalid Glue signature'}).waitFor({timeout: 30_000});
    assert.deepEqual(await account(), before);
    transportMode = 'normal';
    return {forgedAssertionRejected: true, visitorPreserved: true};
  });
  await step('Click Glue, authenticate the passkey, verify the assertion and open Fotos', async () => {
    if (mode === 'popup') {
      const popupPromise = page.waitForEvent('popup');
      const reloaded = page.waitForEvent('load', {timeout: 45_000});
      await page.getByRole('button', {name: 'Sign in with glue.one'}).click();
      const popup = await popupPromise;
      popup.on('pageerror', error => console.log('[glue-page-error]', error.message));
      await reloaded;
    } else {
      const departed = page.waitForEvent('framenavigated', {predicate: frame => frame === page.mainFrame()
        && new URL(frame.url()).origin === 'https://glue.one', timeout: 45_000});
      await page.getByRole('button', {name: 'Sign in with glue.one'}).click();
      await departed;
      await page.waitForURL(url => url.origin === new URL(appUrl).origin, {waitUntil: 'domcontentloaded', timeout: 45_000});
    }
    await ready();
    assert.ok(network.some(request => request.phase === phase && request.path === '/api/auth/passkey/complete' && request.status === 200), 'Real passkey authentication must complete');
    assert.ok(network.some(request => request.phase === phase && request.path === '/api/fedcm/assertion' && request.status === 200), 'Registrar must issue the assertion');
    const selected = await account();
    assert.equal(selected.active, `glue-${fixture.subject}`);
    assert.equal(selected.sessionActive, `glue-${fixture.subject}`);
    const expectedOwner = await page.evaluate(async ({subject, moduleUrl}) => {
      const {calculateIdHashOfObj} = await import(moduleUrl);
      return calculateIdHashOfObj({$type$: 'Person', email: `glue:${subject}`});
    }, {subject: fixture.subject, moduleUrl: '/@fs/' + resolve(root, 'sources/one/packages/one.core/lib/util/object.js')});
    const status = await page.evaluate(() => window.__fotosDebug.getStatus());
    assert.equal(status.ownerId, expectedOwner, 'The unlocked runtime must belong to the verified subject account');
    assert.notEqual(status.ownerId, owner.ownerId, 'Sign-in must leave the visitor runtime');
    return {signedSubject: fixture.subject, expectedOwner, status};
  });
  await step('Reload offline with the exact same local account and no Web Storage secret', async () => {
    const before = await page.evaluate(() => window.__fotosDebug.getLocalIdentitySnapshot());
    await assertNoWebStorageSecret();
    let offlineRequests = 0;
    for (const pattern of ['https://api.glue.one/**', 'https://glue.one/**', `${state.base}/**`, `${new URL(appUrl).origin}/api/**`]) {
      await context.unroute(pattern);
      await context.route(pattern, route => {offlineRequests++; return route.abort('internetdisconnected');});
    }
    await page.reload(); await ready();
    const after = await page.evaluate(() => window.__fotosDebug.getLocalIdentitySnapshot());
    assert.equal(after.ownerId, before.ownerId);
    assert.equal((await account()).active, `glue-${fixture.subject}`);
    assert.equal((await account()).sessionActive, `glue-${fixture.subject}`);
    assert.equal(offlineRequests, 0);
    await assertNoWebStorageSecret();
    return {sameOwner: true, noRemoteAuthNeeded: true, secretAbsentFromWebStorage: true};
  });
} catch (error) {
  if (page) {await page.screenshot({path: resolve(artifacts, 'failure.png')}).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(0,2200));}
  for (const popup of context?.pages() ?? []) {
    if (popup === page || popup.isClosed()) continue;
    await popup.screenshot({path: resolve(artifacts, 'popup-failure.png')}).catch(() => {});
    console.error('[glue-popup]', (await popup.locator('body').innerText().catch(() => '')).slice(0,1200));
  }
  console.error(error); process.exitCode = 1;
} finally {
  writeFileSync(resolve(artifacts, 'report.json'), JSON.stringify({appUrl, mode, fixture, results, network, scope: 'Isolated registrar and real Chromium WebAuthn; no production account writes'}, null, 2));
  await browser?.close();
  console.log(`[fotos-glue-e2e] report: ${resolve(artifacts, 'report.json')}`);
}
