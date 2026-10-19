import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from 'playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseUrl = process.env.FOTOS_QA_URL || 'http://127.0.0.1:5188/';
const appBase = new URL(baseUrl).pathname;
const shareCache = appBase === '/' ? 'fotos-share' : `fotos-share:${appBase}`;
const reports = resolve(root, 'tests/integration/reports/glass-latest');
const fixtures = ['rose-detail.png', 'rose-top-left.jpg'].map(name => resolve(root, 'src/lib/__fixtures__/photos', name));
mkdirSync(reports, {recursive: true});
const browser = await chromium.launch({headless: true, ...(process.env.FOTOS_BROWSER_CHANNEL ? {channel: process.env.FOTOS_BROWSER_CHANNEL} : {})});
const failures = [];
const passed = [];
async function step(name, run) {
    await run();
    passed.push(name);
    console.log(`PASS ${name}`);
}
async function navigate(page, label) {
    await page.getByRole('navigation', {name: 'Library navigation'}).getByRole('button', {name: label, exact: true}).click();
}
async function upload(page) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Upload Photos', exact: true}).click();
    await (await chooser).setFiles(fixtures);
    await expect(page.locator('[data-photo-index]')).toHaveCount(2, {timeout: 60_000});
}

try {
    const context = await browser.newContext({acceptDownloads: true, serviceWorkers: 'block'});
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    page.setDefaultTimeout(15_000);
    try {
        await step('Settings deep link works before opening a library', async () => {
            await page.goto(`${baseUrl}?task=settings`);
            await expect(page.getByRole('heading', {name: 'Profile & preferences'})).toBeVisible();
            await expect(page.getByText('Enable face analytics', {exact: true})).toBeVisible();
            await expect(page.getByRole('navigation', {name: 'Library navigation'})).toBeVisible();
            await expect(page.getByRole('button', {name: 'Enter user ID', exact: true})).toBeVisible();
            await page.getByRole('button', {name: 'Back to home'}).click();
        });
        await step('Petals match the specified placement', async () => {
            await page.screenshot({path: resolve(reports, 'home-desktop.png')});
            const center = async name => page.locator(`.petal-${name}>span`).boundingBox();
            const g = await center('gallery'), a = await center('albums'), f = await center('favorites');
            assert(g && a && f);
            assert(g.y < a.y && g.y < f.y && a.x > f.x);
            await expect(page.getByRole('button', {name: 'Upload Photos', exact: true})).toBeVisible();
        });
        await step('Fresh desktop photo import without an existing folder', async () => {
            await upload(page);
            await expect(page.getByRole('button', {name: 'Open rose-detail.png', exact: true})).toBeVisible();
        });
        await step('Original photo viewer, favorite action and desktop export', async () => {
            await page.getByRole('button', {name: 'Open rose-detail.png', exact: true}).click();
            await expect(page.getByRole('dialog', {name: 'Photo viewer: rose-detail.png'})).toBeVisible();
            await page.getByRole('button', {name: 'Add to favorites', exact: true}).click();
            await expect(page.getByRole('button', {name: 'Remove from favorites', exact: true})).toHaveAttribute('aria-pressed', 'true');
            // Force the download path so this test never opens a native share sheet.
            await page.evaluate(() => Object.defineProperty(navigator, 'canShare', {configurable: true, value: () => false}));
            const download = page.waitForEvent('download');
            await page.getByRole('button', {name: 'Export photo', exact: true}).click();
            assert.equal((await download).suggestedFilename(), 'rose-detail.png');
            await page.getByRole('button', {name: 'Close image view'}).click();
            await navigate(page, 'Favorites');
            await expect(page.locator('[data-photo-index]')).toHaveCount(1);
            await page.getByRole('button', {name: 'Open rose-detail.png', exact: true}).click();
            await expect(page.getByRole('dialog', {name: 'Photo viewer: rose-detail.png'})).toBeVisible();
            await page.getByRole('button', {name: 'Close image view'}).click();
        });
        await step('Favorites and imported photos survive a reload', async () => {
            await page.reload();
            await expect(page.locator('[data-photo-index]')).toHaveCount(1, {timeout: 60_000});
            await navigate(page, 'Gallery');
            await expect(page.locator('[data-photo-index]')).toHaveCount(2);
        });
        await step('Search and photo selection retain original controls', async () => {
            const search = page.getByRole('searchbox', {name: 'Search photos'});
            await search.fill('rose-detail');
            await expect(page.locator('[data-photo-index]')).toHaveCount(1);
            await search.fill('');
            await expect(page.locator('[data-photo-index]')).toHaveCount(2);
            await page.getByRole('button', {name: 'Select photo', exact: true}).first().click();
            await expect(page.getByRole('region', {name: 'Selection actions'})).toBeVisible();
            await expect(page.getByRole('button', {name: 'Share selection…'})).toBeVisible();
            await page.getByRole('button', {name: 'Clear selection'}).click();
        });
        await step('Album create, rename, member selection and reload', async () => {
            await navigate(page, 'Albums');
            await page.getByRole('textbox', {name: 'Album name'}).fill('Glass QA');
            await page.getByRole('button', {name: 'Create album', exact: true}).click();
            await page.getByRole('button', {name: 'Rename Glass QA', exact: true}).click();
            const rename = page.getByRole('dialog', {name: 'Rename album'});
            await rename.getByRole('textbox', {name: 'Album name'}).fill('Memories QA');
            await rename.getByRole('button', {name: 'Rename', exact: true}).click();
            await navigate(page, 'Gallery');
            await page.getByRole('button', {name: 'Select photo', exact: true}).first().click();
            await page.getByRole('button', {name: 'Add to collection', exact: true}).click();
            await page.getByRole('combobox', {name: 'Existing collection'}).selectOption({label: 'Memories QA'});
            await navigate(page, 'Albums');
            await page.getByRole('button', {name: /Memories QA.*1 photos/}).click();
            await expect(page.locator('[data-photo-index]')).toHaveCount(1);
            assert(new URL(page.url()).searchParams.has('album'));
            await page.reload();
            await expect(page.locator('[data-photo-index]')).toHaveCount(1, {timeout: 60_000});
        });
        await step('Album sharing, deletion and undo retain original behavior', async () => {
            await navigate(page, 'Albums');
            await page.getByRole('button', {name: 'Share Memories QA', exact: true}).click();
            assert.equal(new URL(page.url()).searchParams.get('task'), 'sharing');
            await expect(page.getByText('Memories QA', {exact: true}).first()).toBeVisible();
            await navigate(page, 'Albums');
            await page.getByRole('button', {name: 'Delete Memories QA', exact: true}).click();
            await expect(page.getByRole('button', {name: 'Delete Memories QA', exact: true})).toHaveCount(0);
            await page.getByRole('button', {name: 'Undo', exact: true}).click();
            await expect(page.getByRole('button', {name: 'Delete Memories QA', exact: true})).toBeVisible();
        });
        await step('Browser Back/Forward restores destinations', async () => {
            await navigate(page, 'Favorites');
            await navigate(page, 'Albums');
            await page.goBack();
            await expect(page.getByRole('heading', {name: 'Favorites', exact: true})).toBeVisible();
            await page.goForward();
            await expect(page.getByRole('heading', {name: 'Albums', exact: true})).toBeVisible();
            await page.screenshot({path: resolve(reports, 'albums-desktop.png')});
        });
        await step('Removing the final favorite closes the viewer safely', async () => {
            await navigate(page, 'Favorites');
            await page.getByRole('button', {name: 'Open rose-detail.png', exact: true}).click();
            await page.getByRole('button', {name: 'Remove from favorites', exact: true}).click();
            await expect(page.getByRole('dialog', {name: /Photo viewer/})).toHaveCount(0);
            await expect(page.getByText('Your favorite moments', {exact: true})).toBeVisible();
        });
    } catch (error) {
        await page.screenshot({path: resolve(reports, 'desktop-failure.png')});
        throw error;
    } finally {await context.close();}

    await step('Legacy favorite hearts migrate into persisted library settings', async () => {
        const isolated = await browser.newContext({serviceWorkers: 'block'});
        try {
            const p = await isolated.newPage();
            await p.addInitScript(() => {
                if (!localStorage.getItem('fotos.browser.library-state')) localStorage.setItem('fotos.favorite-hashes', '["legacy-photo"]');
            });
            await p.goto(baseUrl);
            await p.waitForFunction(() => JSON.parse(localStorage.getItem('fotos.browser.library-state') ?? '{}').favoriteHashes?.includes('legacy-photo'));
            await p.reload();
            await p.waitForFunction(() => JSON.parse(localStorage.getItem('fotos.browser.library-state') ?? '{}').favoriteHashes?.includes('legacy-photo'));
        } finally {await isolated.close();}
    });
    await step('Storage failures produce a visible import error and retry', async () => {
        const isolated = await browser.newContext({serviceWorkers: 'block'});
        try {
            const p = await isolated.newPage();
            await p.addInitScript(() => Object.defineProperty(navigator.storage, 'getDirectory', {value: async () => {throw new DOMException('Storage full', 'QuotaExceededError');}}));
            await p.goto(baseUrl);
            const chooser = p.waitForEvent('filechooser');
            await p.getByRole('button', {name: 'Upload Photos', exact: true}).click();
            await (await chooser).setFiles(fixtures[0]);
            await expect(p.getByRole('alert')).toContainText('Storage full');
            await expect(p.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
            await p.getByRole('button', {name: 'Dismiss', exact: true}).click();
            await expect(p.getByRole('alert')).toHaveCount(0);
        } finally {await isolated.close();}
    });
    await step('Pending Web Share Target photos remain visible and can be imported', async () => {
        const isolated = await browser.newContext({serviceWorkers: 'block'});
        try {
            const p = await isolated.newPage();
            await p.goto(baseUrl);
            await p.evaluate(async ({bytes, appBase, shareCache}) => {
                const cache = await caches.open(shareCache);
                await cache.put(`${appBase}_shared/count`, new Response('1'));
                await cache.put(`${appBase}_shared/0`, new Response(new Uint8Array(bytes), {headers: {'Content-Type': 'image/png', 'X-Filename': 'shared-fixture.png'}}));
            }, {bytes: Array.from(readFileSync(fixtures[0])), appBase, shareCache});
            await p.goto(`${baseUrl}?share=1`);
            await expect(p.getByRole('complementary', {name: 'Pending shared photos'})).toContainText('1 shared photo');
            await p.evaluate(async () => {
                const root = await navigator.storage.getDirectory();
                const folder = await root.getDirectoryHandle('Shared-QA', {create: true});
                window.showDirectoryPicker = async () => folder;
            });
            await p.getByRole('button', {name: 'Choose destination', exact: true}).click();
            await expect(p.getByRole('button', {name: 'Open shared-fixture.png', exact: true})).toBeVisible({timeout: 60_000});
            await expect(p.getByRole('complementary', {name: 'Pending shared photos'})).toHaveCount(0);
            assert.equal(await p.evaluate(name => caches.has(name), shareCache), false);
        } finally {await isolated.close();}
    });

    const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, serviceWorkers: 'block'});
    const phone = await mobile.newPage();
    phone.on('pageerror', error => failures.push(error.message));
    try {
        await step('Mobile petal hit targets, upload and account access', async () => {
            await phone.goto(baseUrl);
            await phone.locator('.petal-gallery>span').click();
            await expect(phone.getByRole('heading', {name: 'Gallery', exact: true})).toBeVisible();
            await phone.getByRole('button', {name: 'Back to home'}).click();
            await phone.screenshot({path: resolve(reports, 'home-mobile.png')});
            await upload(phone);
            await navigate(phone, 'Profile');
            await expect(phone.getByText('Enable face analytics', {exact: true})).toBeVisible();
            await phone.screenshot({path: resolve(reports, 'profile-mobile.png')});
        });
        await step('Mobile and landscape layouts fit the screen', async () => {
            for (const [width, height] of [[390, 844], [844, 390], [320, 568]]) {
                await phone.setViewportSize({width, height});
                assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await expect(phone.getByRole('button', {name: 'Back to home'})).toBeInViewport();
            }
        });
    } catch (error) {
        await phone.screenshot({path: resolve(reports, 'mobile-failure.png')});
        throw error;
    } finally {await mobile.close();}
    assert.deepEqual(failures, [], 'No uncaught browser errors');
    console.log(`${passed.length} glass UI flows passed.`);
} finally {await browser.close();}
