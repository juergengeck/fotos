#!/usr/bin/env node

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browserUiRoot = resolve(here, '../..');
const repoRoot = resolve(browserUiRoot, '../..');
const sharedVgerRoot = resolve(repoRoot, '../vger');
const baseUrl = process.env.FOTOS_QA_URL || 'http://127.0.0.1:5188/';
const artifactDir = process.env.FOTOS_QA_ARTIFACT_DIR || resolve(here, 'reports/ui-latest');
const fixturePaths = [
  resolve(browserUiRoot, 'src/lib/__fixtures__/photos/rose-detail.png'),
  resolve(browserUiRoot, 'src/lib/__fixtures__/photos/rose-top-left.jpg'),
];
const READY_TIMEOUT_MS = Number(process.env.FOTOS_QA_READY_TIMEOUT_MS || 120_000);

const results = [];

function event(type, step, details = {}) {
  const payload = {type, step, at: new Date().toISOString(), ...details};
  console.log(`[fotos-qa-event] ${JSON.stringify(payload)}`);
}

async function runStep(id, title, run) {
  const startedAt = Date.now();
  event('step-start', id, {title});
  try {
    const details = await run();
    const result = {id, title, status: 'passed', durationMs: Date.now() - startedAt, details: details ?? {}};
    results.push(result);
    event('step-pass', id, {title, durationMs: result.durationMs});
    return details;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = {id, title, status: 'failed', durationMs: Date.now() - startedAt, error: message};
    results.push(result);
    event('step-fail', id, {title, durationMs: result.durationMs, error: message});
    throw error;
  }
}

function resolvePnpmPlaywright() {
  const pnpmRoot = resolve(sharedVgerRoot, 'node_modules/.pnpm');
  if (!existsSync(pnpmRoot)) return null;
  const match = readdirSync(pnpmRoot).find(name => name === 'playwright' || name.startsWith('playwright@'));
  if (!match) return null;
  const entry = resolve(pnpmRoot, match, 'node_modules/playwright/index.js');
  return existsSync(entry) ? entry : null;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const fallback = resolvePnpmPlaywright();
    if (!fallback) throw new Error('Playwright is unavailable; install it in the shared vger workspace');
    return await import(pathToFileURL(fallback).href);
  }
}

function mimeType(filePath) {
  return filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

async function seedDirectoryPicker(page, label) {
  const files = fixturePaths.map((filePath, index) => ({
    bytes: Array.from(readFileSync(filePath)),
    name: `qa-${label}-${index + 1}${filePath.endsWith('.png') ? '.png' : '.jpg'}`,
    type: mimeType(filePath),
  }));
  return await page.evaluate(async ({dirName, files: seededFiles}) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(dirName, {create: true});
    for await (const [entryName] of directory.entries()) {
      await directory.removeEntry(entryName, {recursive: true});
    }
    for (const seeded of seededFiles) {
      const fileHandle = await directory.getFileHandle(seeded.name, {create: true});
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([new Uint8Array(seeded.bytes)], {type: seeded.type}));
      await writable.close();
    }
    window.__fotosTestGalleryHandle = directory;
    window.showDirectoryPicker = async () => directory;
    return seededFiles.map(file => file.name);
  }, {dirName: `fotos-ui-qa-${label}`, files});
}

async function waitForDebug(page) {
  await page.waitForFunction(() => Boolean(window.__fotosDebug), undefined, {timeout: READY_TIMEOUT_MS});
}

async function waitForGallery(page, expectedCount = 2) {
  await waitForDebug(page);
  await page.waitForFunction(count => {
    const state = window.__fotosDebug?.getGalleryState?.();
    return Boolean(state?.isOpen && state.totalCount >= count);
  }, expectedCount, {timeout: READY_TIMEOUT_MS});
  return await page.evaluate(() => window.__fotosDebug.getGalleryState());
}

async function expectOne(locator, label) {
  await locator.waitFor({state: 'visible', timeout: 15_000});
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label}: expected one element, found ${count}`);
  return locator;
}

async function clickOne(locator, label) {
  await expectOne(locator, label);
  await locator.click();
}

async function runDesktop(browser) {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 900},
    serviceWorkers: 'block',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const names = fixturePaths.map((filePath, index) => `qa-desktop-${index + 1}${filePath.endsWith('.png') ? '.png' : '.jpg'}`);
  try {
    await runStep('cold-start', 'Cold start and intake affordances', async () => {
      await page.goto(new URL('?fotosDebug=1&qa=desktop', baseUrl).toString(), {waitUntil: 'domcontentloaded'});
      await expectOne(page.getByRole('heading', {name: 'Your photos, on your device'}), 'landing heading');
      await expectOne(page.getByRole('button', {name: 'Open Photo Folder'}), 'intake button');
      await expectOne(page.getByRole('button', {name: 'Advanced: connect to server'}), 'headless connection affordance');
      await clickOne(page.getByRole('button', {name: 'Impressum'}), 'legal notice');
      await expectOne(page.getByRole('dialog'), 'legal notice dialog');
      await clickOne(page.getByRole('button', {name: 'Close legal notice'}), 'close legal notice');
      return {headline: 'Your photos, on your device'};
    });

    await runStep('intake', 'Seeded folder intake and product-state projection', async () => {
      const seededNames = await seedDirectoryPicker(page, 'desktop');
      await clickOne(page.getByRole('button', {name: 'Open Photo Folder'}), 'open seeded photo folder');
      const gallery = await waitForGallery(page, seededNames.length);
      for (const name of seededNames) await expectOne(page.getByRole('button', {name: `Open ${name}`}), `photo ${name}`);
      return {folderName: gallery.folderName, totalCount: gallery.totalCount, names: seededNames};
    });

    await runStep('browse', 'Browse controls, search, sort, and people switch', async () => {
      const search = await expectOne(page.getByRole('searchbox', {name: 'Search photos'}), 'photo search');
      await search.fill('qa-desktop-1');
      await page.waitForFunction(() => window.__fotosDebug?.getGalleryState?.().visibleCount === 1, undefined, {timeout: READY_TIMEOUT_MS});
      await search.fill('');
      const sort = await expectOne(page.locator('select').filter({has: page.locator('option[value="date"]')}), 'sort selector');
      await sort.selectOption('name');
      await clickOne(page.getByRole('button', {name: 'Newest'}), 'sort order');
      const peopleButton = await expectOne(page.getByRole('button', {name: 'People', exact: true}), 'people mode');
      await peopleButton.click();
      await expectOne(page.getByRole('dialog', {name: 'Turn on face analytics?'}), 'People activation confirmation');
      await expectOne(page.getByRole('button', {name: 'Turn on People view', exact: true}), 'People activation action');
      await clickOne(page.getByRole('button', {name: 'Cancel', exact: true}), 'cancel People activation');
      return {search: true, sort: 'name/ascending', peopleActivationBoundary: true};
    });

    await runStep('lightbox', 'Photo route, details, zoom, and transform controls', async () => {
      await clickOne(page.getByRole('button', {name: `Open ${names[0]}`}), 'open first photo');
      await expectOne(page.getByRole('dialog', {name: `Photo viewer: ${names[0]}`}), 'photo viewer');
      for (const title of ['Fit (F)', '1:1', 'Zoom out (-)', 'Zoom in (+)', 'Rotate left (L)', 'Rotate right (R)', 'Flip H', 'Flip V']) {
        await expectOne(page.getByTitle(title), `viewer control ${title}`);
      }
      await page.waitForFunction(name => {
        const image = document.querySelector(`[role="dialog"] img[alt="${name}"]`);
        return image?.complete && image.naturalWidth > 0;
      }, names[0]);
      await clickOne(page.getByTitle('1:1', {exact: true}), 'actual image size');
      await clickOne(page.getByTitle('Rotate right (R)'), 'rotate image');
      await page.waitForFunction(name => document.querySelector(`[role="dialog"] img[alt="${name}"]`)?.style.transform.includes('rotate(90deg)'), names[0]);
      await clickOne(page.getByTitle('Flip H', {exact: true}), 'flip image');
      await page.waitForFunction(name => document.querySelector(`[role="dialog"] img[alt="${name}"]`)?.style.transform.includes('scale(-'), names[0]);
      const atLastPhoto = await page.getByText('2 of 2', {exact: true}).isVisible();
      await page.keyboard.press(atLastPhoto ? 'ArrowLeft' : 'ArrowRight');
      await expectOne(page.getByRole('dialog', {name: `Photo viewer: ${names[1]}`}), 'neighbouring photo');
      await page.keyboard.press(atLastPhoto ? 'ArrowRight' : 'ArrowLeft');
      await expectOne(page.getByRole('dialog', {name: `Photo viewer: ${names[0]}`}), 'previous photo');
      await clickOne(page.getByRole('button', {name: 'Toggle details sidebar'}), 'details sidebar');
      await clickOne(page.getByRole('button', {name: 'Close image view'}), 'close viewer');
      return {imageDecoded: true, rotationApplied: true, flipApplied: true, nextAndPrevious: true, details: true};
    });

    await runStep('selection-collection', 'Selection and collection lifecycle', async () => {
      await expectOne(page.getByRole('button', {name: `Open ${names[0]}`}), 'first photo selection target');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('x');
      await expectOne(page.getByRole('region', {name: 'Selection actions'}), 'selection action bar');
      await clickOne(page.getByRole('button', {name: 'Add to collection'}), 'add to collection');
      const nameInput = await expectOne(page.getByRole('textbox', {name: 'New collection name'}), 'collection name');
      await nameInput.fill('QA Collection');
      await clickOne(page.getByRole('button', {name: 'Create'}), 'create collection');
      await expectOne(page.getByText('QA Collection', {exact: true}), 'created collection');
      return {collection: 'QA Collection'};
    });

    await runStep('context-menu', 'Photo context menu and destructive confirmation boundary', async () => {
      await clickOne(page.getByRole('navigation', {name: 'Breadcrumb'}).getByRole('button', {name: 'Photos', exact: true}), 'return to all photos');
      const card = await expectOne(page.getByRole('button', {name: `Open ${names[1]}`}), 'second photo');
      await card.click({button: 'right'});
      const menu = await expectOne(page.getByRole('menu', {name: 'Photo actions'}), 'photo actions menu');
      for (const item of ['Share Photo', 'Select Photo', 'Delete Photo']) {
        const candidates = menu.getByRole('menuitem', {name: item});
        const count = await candidates.count();
        if (count !== 1 && !(item === 'Select Photo' && count === 0)) throw new Error(`Missing context action ${item}`);
      }
      await page.keyboard.press('Escape');
      return {actions: ['share', 'select', 'delete']};
    });

    await runStep('sharing-settings', 'Sharing and settings control surfaces', async () => {
      const sidePanel = page.locator('[aria-label="Side panel"]');
      await clickOne(sidePanel.getByRole('button', {name: 'sharing', exact: true}), 'sharing tab');
      await expectOne(page.getByText('Share gallery', {exact: true}), 'share gallery section');
      await clickOne(sidePanel.getByRole('button', {name: 'settings', exact: true}), 'settings tab');
      const settingsSections = page.locator('[aria-label="Settings sections"]');
      for (const label of ['Identity', 'Storage', 'Image AI', 'Saved places', 'Devices']) {
        await expectOne(settingsSections.getByRole('button', {name: label, exact: true}), `settings section ${label}`);
      }
      await expectOne(page.getByText('fotos id', {exact: true}), 'fotos identity settings');
      await expectOne(page.getByText('Enable face analytics', {exact: true}), 'face analytics setting');
      await expectOne(page.getByText('Enable semantic search', {exact: true}), 'semantic search setting');
      return {sections: 5, identity: true};
    });

    await runStep('control-pane', 'Desktop control-pane collapse and restoration', async () => {
      await clickOne(page.getByRole('button', {name: 'Close control pane'}), 'close control pane');
      await clickOne(page.getByRole('button', {name: 'Open control pane'}), 'open control pane');
      await expectOne(page.getByRole('button', {name: 'Close control pane'}), 'restored control pane');
      return {collapsed: true, restored: true};
    });
    await runStep('reopen-library', 'Reopen the library and saved collection after reload', async () => {
      const before = await page.evaluate(() => window.__fotosDebug.getGalleryState());
      await page.reload({waitUntil: 'domcontentloaded'});
      const restored = await waitForGallery(page, names.length);
      if (restored.totalCount !== before.totalCount) throw new Error('Library count changed after reopening');
      await clickOne(page.locator('[aria-label="Side panel"]').getByRole('button', {name: 'browse', exact: true}), 'return to browse');
      if (!await page.getByRole('button', {name: 'Open collection QA Collection', exact: true}).isVisible()) {
        await clickOne(page.getByRole('button', {name: 'Collections', exact: true}), 'expand collections');
      }
      await clickOne(page.getByRole('button', {name: 'Open collection QA Collection', exact: true}), 'reopen saved collection');
      await page.waitForFunction(() => window.__fotosDebug?.getGalleryState?.().visibleCount === 1);
      return {restoredPhotos: restored.totalCount, collectionVisibleCount: 1};
    });
  } catch (error) {
    mkdirSync(artifactDir, {recursive: true});
    await page.screenshot({path: resolve(artifactDir, 'desktop-failure.png'), fullPage: true}).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

async function runMobile(browser) {
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  try {
    await runStep('mobile-sheet', 'Mobile intake and bottom-sheet navigation', async () => {
      await page.goto(new URL('?fotosDebug=1&qa=mobile', baseUrl).toString(), {waitUntil: 'domcontentloaded'});
      const fileChooserPromise = page.waitForEvent('filechooser');
      await clickOne(page.getByRole('button', {name: /select photos/i}), 'mobile intake');
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(fixturePaths);
      await waitForGallery(page, fixturePaths.length);
      for (const tab of ['Browse', 'Sharing', 'Settings']) await expectOne(page.getByRole('button', {name: tab, exact: true}), `mobile ${tab}`);
      await clickOne(page.getByRole('button', {name: 'Settings', exact: true}), 'mobile settings sheet');
      await expectOne(page.getByText('Enable face analytics', {exact: true}), 'mobile settings content');
      await clickOne(page.getByRole('button', {name: 'Settings', exact: true}), 'collapse mobile settings sheet');
      return {viewport: '390x844', tabs: 3, collapse: true};
    });
  } catch (error) {
    mkdirSync(artifactDir, {recursive: true});
    await page.screenshot({path: resolve(artifactDir, 'mobile-failure.png'), fullPage: true}).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  for (const fixture of fixturePaths) if (!existsSync(fixture)) throw new Error(`Fixture not found: ${fixture}`);
  mkdirSync(artifactDir, {recursive: true});
  const playwrightModule = await loadPlaywright();
  const playwright = playwrightModule.default ?? playwrightModule;
  const browser = await playwright.chromium.launch({headless: process.env.HEADLESS !== 'false'});
  const startedAt = new Date().toISOString();
  try {
    await runDesktop(browser);
    await runMobile(browser);
  } finally {
    await browser.close();
    writeFileSync(resolve(artifactDir, 'report.json'), JSON.stringify({baseUrl, startedAt, finishedAt: new Date().toISOString(), results}, null, 2));
  }
  console.log(`[fotos-ui] ${results.length} UI steps passed; report=${resolve(artifactDir, 'report.json')}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
