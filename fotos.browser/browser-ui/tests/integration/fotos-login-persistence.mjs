import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.FOTOS_QA_URL || 'http://127.0.0.1:5188/';
const browser = await chromium.launch({
    headless: true,
    ...(process.env.FOTOS_TEST_BROWSER ? { executablePath: process.env.FOTOS_TEST_BROWSER } : {}),
});
const fixture = await readFile(new URL('../../src/lib/__fixtures__/photos/rose-detail.png', import.meta.url));
const context = await browser.newContext({ serviceWorkers: 'block' });
let cert;
let unavailable = false;

async function waitForGallery(page, count) {
    await page.waitForFunction(expected => window.__fotosDebug?.getGalleryState().totalCount === expected,
        count, { timeout: 45_000 });
    return page.evaluate(() => window.__fotosDebug.getGalleryState());
}

try {
    // Exercise the real app and popup protocol without registering an account on Glue.
    await context.routeWebSocket('wss://api.glue.one/**', socket => socket.close());
    await context.exposeBinding('captureTestCertificate', (_source, value) => { cert = value; });
    await context.route('https://glue.one/auth**', route => route.fulfill({
        contentType: 'text/html',
        body: `<script>
            addEventListener('message', async event => {
                if (event.data.type !== 'auth-request') return;
                await window.captureTestCertificate(event.data.cert);
                event.source.postMessage({type:'auth-result',requestId:event.data.requestId,
                    success:true,data:{cert:event.data.cert}}, event.origin);
                window.close();
            });
            window.opener.postMessage({type:'auth-ready'}, '*');
        </script>`,
    }));
    await context.route('**/api/**', route => {
        if (route.request().url().includes('/registration/certByPublicKey/')) {
            if (unavailable) return route.abort('failed');
            return route.fulfill({ status: cert ? 200 : 404, json: { data: { cert } } });
        }
        return route.fulfill({ json: { success: true, data: { passkeys: [] } } });
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}?fotosDebug=1`);
    await page.waitForFunction(() => Boolean(window.__fotosDebug));
    await page.evaluate(bytesBase64 => window.__api('fotos-qa', 'importPhotoFixture', {
        name: 'remember-me.png', mimeType: 'image/png', bytesBase64,
    }), fixture.toString('base64'));
    const before = await page.evaluate(() => ({
        creds: localStorage.getItem('fotos_creds'),
        ownerId: window.__fotosDebug.getStatus().ownerId,
    }));
    await page.getByRole('button', { name: /^settings$/i }).click();
    await page.getByPlaceholder('Your name on glue.one').fill('Remember Me');
    await page.getByRole('button', { name: 'Prepare authentication', exact: true }).click();
    await page.getByRole('button', { name: 'Authenticate', exact: true }).waitFor({ timeout: 45_000 });
    await waitForGallery(page, 1);
    await page.getByRole('button', { name: 'Authenticate', exact: true }).click();
    await page.getByRole('button', { name: 'Change user ID', exact: true }).waitFor();
    const identity = await page.evaluate(() => window.__api('fotos-qa', 'getIdentity'));
    assert.equal(identity.glueDisplayName, 'Remember Me');
    assert.ok(await page.evaluate(() => localStorage.getItem('fotos.glue.certifications')));

    unavailable = true;
    await page.reload();
    await page.getByRole('button', { name: 'Change user ID', exact: true }).waitFor({ timeout: 45_000 });
    assert.equal((await waitForGallery(page, 1)).items[0].name, 'remember-me.png');
    assert.deepEqual(await page.evaluate(() => ({
        creds: localStorage.getItem('fotos_creds'), ownerId: window.__fotosDebug.getStatus().ownerId,
    })), before);
    assert.equal((await page.evaluate(() => window.__api('fotos-qa', 'getIdentity'))).publicationIdentity,
        identity.publicationIdentity);
    console.log('PASS: popup login, identity and photo survive reload with Glue unavailable');

    // A selected directory remains remembered when the browser renews its permission.
    const folderPage = await context.newPage();
    await folderPage.goto(`${baseUrl}?fotosDebug=1`);
    await folderPage.waitForFunction(() => Boolean(window.__fotosDebug));
    await folderPage.evaluate(async bytes => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle('permission-library', { create: true });
        const file = await directory.getFileHandle('saved-folder.png', { create: true });
        const writable = await file.createWritable();
        await writable.write(new Uint8Array(bytes));
        await writable.close();
        window.showDirectoryPicker = async () => directory;
        window.__fotosDebug.openLocalPicker();
    }, Array.from(fixture));
    await waitForGallery(folderPage, 2);
    await folderPage.addInitScript(() => {
        FileSystemDirectoryHandle.prototype.queryPermission = async function () {
            return this.name === 'permission-library' && !sessionStorage.getItem('testFolderGranted')
                ? 'prompt' : 'granted';
        };
        FileSystemDirectoryHandle.prototype.requestPermission = async function () {
            sessionStorage.setItem('testFolderGranted', '1');
            return 'granted';
        };
    });
    await folderPage.reload();
    await waitForGallery(folderPage, 1);
    await folderPage.getByRole('button', { name: 'Reopen saved library', exact: true }).waitFor();
    // Restoring the accessible folder must not erase its unavailable sibling.
    await folderPage.reload();
    await waitForGallery(folderPage, 1);
    await folderPage.getByRole('button', { name: 'Reopen saved library', exact: true }).waitFor();
    // Keep only the external-style handle to exercise the landing recovery action.
    await folderPage.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('fotos-prefs', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            const store = tx.objectStore('handles');
            const request = store.get('folders');
            request.onsuccess = () => store.put(request.result.filter(folder => folder.preference.label === 'permission-library'), 'folders');
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
        });
        db.close();
    });
    await folderPage.reload();
    await folderPage.getByRole('button', { name: 'Reopen saved library', exact: true }).click();
    assert.equal((await waitForGallery(folderPage, 1)).items[0].name, 'saved-folder.png');
    await folderPage.reload();
    assert.equal((await waitForGallery(folderPage, 1)).items[0].name, 'saved-folder.png');
    console.log('PASS: saved folder survives renewed permission and reopens without reimporting');
} finally {
    await context.close();
    await browser.close();
}
