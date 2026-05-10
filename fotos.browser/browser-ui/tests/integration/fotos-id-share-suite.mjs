#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const VGER_ROOT = resolve(REPO_ROOT, 'vger');
const SHARED_VGER_ROOT = resolve(REPO_ROOT, '../vger');
const DEFAULT_BASE_URL = 'http://localhost:5518/';
const DEFAULT_API_BASE = 'http://localhost:5517';
const READY_TIMEOUT_MS = Number(process.env.FOTOS_LIVE_READY_TIMEOUT_MS || 180_000);
const PRESENCE_TIMEOUT_MS = Number(process.env.FOTOS_LIVE_PRESENCE_TIMEOUT_MS || 120_000);
const CONNECTION_TIMEOUT_MS = Number(process.env.FOTOS_LIVE_CONNECTION_TIMEOUT_MS || 90_000);
const SHARE_TIMEOUT_MS = Number(process.env.FOTOS_LIVE_SHARE_TIMEOUT_MS || 120_000);
const POLL_INTERVAL_MS = Number(process.env.FOTOS_LIVE_POLL_MS || 1_000);
const DEFAULT_FIXTURE_A = resolve(
  REPO_ROOT,
  'fotos.browser/browser-ui/src/lib/__fixtures__/photos/rose-detail.png',
);
const DEFAULT_FIXTURE_B = resolve(
  REPO_ROOT,
  'fotos.browser/browser-ui/src/lib/__fixtures__/photos/rose-top-left.jpg',
);
const FIXTURE_A = process.env.FOTOS_LIVE_FIXTURE_A?.trim() || DEFAULT_FIXTURE_A;
const FIXTURE_B = process.env.FOTOS_LIVE_FIXTURE_B?.trim() || DEFAULT_FIXTURE_B;
const OPEN_FOLDER_BUTTON_PATTERN = /^Open photo folder$/i;
const RESCAN_BUTTON_PATTERN = /^Rescan folder$/i;

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

async function settleWithin(promise, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise(resolvePromise => {
        timeoutId = setTimeout(() => resolvePromise(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isTransientDebugApiError(error) {
  const message = getErrorMessage(error);
  return (
    message.includes('Cannot read properties of undefined') ||
    message.includes('Execution context was destroyed') ||
    message.includes('Most likely because of a navigation') ||
    message.includes('Target page, context or browser has been closed')
  );
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const fallbackPath = resolveFallbackPackageEntry(
      ['playwright'],
      [VGER_ROOT, SHARED_VGER_ROOT],
    );
    if (!fallbackPath) {
      throw new Error(
        'Playwright is not installed in this workspace. Install it in the shared vger repo or add it to fotos.browser/browser-ui.',
      );
    }

    return await import(pathToFileURL(fallbackPath).href);
  }
}

function resolveFallbackPackageEntry(packageNames, roots) {
  for (const root of roots) {
    for (const packageName of packageNames) {
      const directEntry = resolve(root, `node_modules/${packageName}/index.js`);
      if (existsSync(directEntry)) {
        return directEntry;
      }

      const pnpmEntry = resolvePnpmPackageEntry(root, packageName);
      if (pnpmEntry) {
        return pnpmEntry;
      }
    }
  }

  return null;
}

function resolvePnpmPackageEntry(root, packageName) {
  const pnpmRoot = resolve(root, 'node_modules/.pnpm');
  if (!existsSync(pnpmRoot)) {
    return null;
  }

  const match = readdirSync(pnpmRoot).find(name => name === packageName || name.startsWith(`${packageName}@`));
  if (!match) {
    return null;
  }

  const entry = resolve(pnpmRoot, match, 'node_modules', packageName, 'index.js');
  return existsSync(entry) ? entry : null;
}

async function launchBrowser(playwrightModule, headless) {
  const playwright = playwrightModule.default ?? playwrightModule;
  const browserName = process.env.FOTOS_LIVE_BROWSER || 'chromium';
  const browserType = playwright[browserName];

  if (!browserType) {
    throw new Error(`Unsupported Playwright browser '${browserName}'`);
  }

  return await browserType.launch({ headless });
}

function toGlueIdentity(displayName) {
  return `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}@glue.one`;
}

function buildUrl(baseUrl, pageLabel) {
  const url = new URL(baseUrl);
  url.searchParams.set('fotosDebug', '1');
  url.searchParams.set('page', pageLabel);
  return url.toString();
}

async function waitForDebugApi(page, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    try {
      await page.waitForFunction(() => Boolean(window.__fotosDebug), undefined, {
        timeout: Math.max(250, Math.min(5_000, remaining)),
      });
      return;
    } catch (error) {
      if (!isTransientDebugApiError(error) && !getErrorMessage(error).includes('Timeout')) {
        throw error;
      }
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for fotos debug API after ${timeoutMs}ms`);
}

async function evaluateWithDebugApi(page, fn, arg, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) {
      break;
    }

    await waitForDebugApi(page, remaining);

    try {
      return await page.evaluate(fn, arg);
    } catch (error) {
      if (!isTransientDebugApiError(error)) {
        throw error;
      }
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for a stable fotos debug API after ${timeoutMs}ms`);
}

async function getStatus(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getStatus(), undefined, timeoutMs);
}

async function getLocalIdentitySnapshot(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getLocalIdentitySnapshot(), undefined, timeoutMs);
}

async function prepareIdentity(page, displayName, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async targetDisplayName => {
    return await window.__fotosDebug.prepareIdentity(targetDisplayName);
  }, displayName, timeoutMs);
}

async function registerPreparedIdentity(page, displayName, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async targetDisplayName => {
    return await window.__fotosDebug.registerPreparedIdentity(targetDisplayName);
  }, displayName, timeoutMs);
}

async function getPresenceSnapshot(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getPresenceSnapshot(), undefined, timeoutMs);
}

async function getOnlinePeers(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getOnlinePeers(), undefined, timeoutMs);
}

async function getSharePeerOptions(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => {
    if (typeof window.__fotosDebug.getSharePeerOptions !== 'function') {
      return [];
    }

    return window.__fotosDebug.getSharePeerOptions();
  }, undefined, timeoutMs);
}

async function resolveShareToken(page, token, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async targetToken => {
    if (typeof window.__fotosDebug.resolveShareToken !== 'function') {
      return null;
    }

    return await window.__fotosDebug.resolveShareToken(targetToken);
  }, token, timeoutMs);
}

async function getWantedPeerIds(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getWantedPeerIds(), undefined, timeoutMs);
}

async function getConnectablePeerIds(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getConnectablePeerIds(), undefined, timeoutMs);
}

async function getPeerConnectionCoordinatorDebug(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(
    page,
    () => window.__fotosDebug.getPeerConnectionCoordinatorDebug(),
    undefined,
    timeoutMs,
  );
}

async function getPeerConnectionInfo(page, personId, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, targetPersonId => {
    return window.__fotosDebug.getPeerConnectionInfo(targetPersonId);
  }, personId, timeoutMs);
}

async function forceRouteKeyConnect(page, personId, keySource = 'advertised', timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async ({ targetPersonId, source }) => {
    return await window.__fotosDebug.forceRouteKeyConnect(targetPersonId, source);
  }, { targetPersonId: personId, source: keySource }, timeoutMs);
}

async function requestCoordinatorPeerConnection(page, personId, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, targetPersonId => {
    if (typeof window.__fotosDebug.requestPeerConnection !== 'function') {
      return null;
    }

    return window.__fotosDebug.requestPeerConnection(targetPersonId);
  }, personId, timeoutMs);
}

function hasUsablePeerLaneEntry(peerState) {
  return Boolean(
    peerState?.hasRelayLane
    || peerState?.hasDirectLane
    || peerState?.state === 'relay-active',
  );
}

async function inspectPeerConnectionTarget(page, personId) {
  const [connectionInfo, coordinatorDebug] = await Promise.all([
    getPeerConnectionInfo(page, personId, 10_000).catch(() => null),
    getPeerConnectionCoordinatorDebug(page, 10_000).catch(() => []),
  ]);
  const targetState = coordinatorDebug?.find(peer => peer?.personId === personId) ?? null;

  return {
    connectionInfo,
    targetState,
  };
}

async function requestSinglePeerConnection(page, personId, inspected = null) {
  const inspection = inspected ?? await inspectPeerConnectionTarget(page, personId);
  const { connectionInfo, targetState } = inspection;

  if (hasUsablePeerLaneEntry(targetState)) {
    return {
      requested: false,
      skipped: 'target-lane-active',
      connectionInfo,
      targetState,
    };
  }

  const coordinatorResult = await requestCoordinatorPeerConnection(page, personId, 10_000);
  const shouldReturnCoordinatorOnly = (
    coordinatorResult?.requested
    && targetState?.state
    && targetState.state !== 'discovered'
  );
  if (shouldReturnCoordinatorOnly) {
    return {
      requested: true,
      strategy: 'coordinator',
      result: coordinatorResult,
      connectionInfo,
      targetState,
    };
  }

  const attempts = ['advertised', 'certified'];
  const errors = [];

  for (const keySource of attempts) {
    try {
      const result = await forceRouteKeyConnect(page, personId, keySource, 10_000);
      return {
        requested: true,
        strategy: coordinatorResult?.requested ? 'coordinator+route-key' : 'route-key',
        keySource,
        coordinatorResult,
        result,
        connectionInfo,
        targetState,
      };
    } catch (error) {
      const message = getErrorMessage(error);
      if (!/No (advertised|certified) encryption key available/i.test(message)) {
        throw error;
      }

      errors.push(message);
    }
  }

  return {
    requested: false,
    coordinatorResult,
    connectionInfo,
    targetState,
    errors,
  };
}

function shouldRequestFallbackLane(primaryAttempt, fallbackAttempt) {
  if (!primaryAttempt || !fallbackAttempt) {
    return false;
  }

  if (hasUsablePeerLaneEntry(fallbackAttempt.targetState)) {
    return false;
  }

  const primaryVerified = primaryAttempt.connectionInfo?.hasVerifiedIdentity === true;
  const primaryLaneUsable = hasUsablePeerLaneEntry(primaryAttempt.targetState);
  if (!primaryVerified || !primaryLaneUsable) {
    return true;
  }

  return false;
}

async function requestPeerConnection(page, primaryPersonId, fallbackPersonId = null) {
  const targetInspection = await inspectPeerConnectionTarget(page, primaryPersonId);
  const targetAttempt = await requestSinglePeerConnection(page, primaryPersonId, targetInspection);
  const normalizedFallbackPersonId = (
    typeof fallbackPersonId === 'string'
    && fallbackPersonId.trim().length > 0
    && fallbackPersonId !== primaryPersonId
  )
    ? fallbackPersonId
    : null;

  if (!normalizedFallbackPersonId) {
    return targetAttempt;
  }

  const fallbackInspection = await inspectPeerConnectionTarget(page, normalizedFallbackPersonId);
  if (!shouldRequestFallbackLane(targetAttempt, fallbackInspection)) {
    return {
      ...targetAttempt,
      fallbackTargetId: normalizedFallbackPersonId,
      fallbackAttempt: {
        requested: false,
        skipped: hasUsablePeerLaneEntry(fallbackInspection.targetState)
          ? 'target-lane-active'
          : 'primary-lane-preferred',
        ...fallbackInspection,
      },
    };
  }

  const fallbackAttempt = await requestSinglePeerConnection(page, normalizedFallbackPersonId, fallbackInspection);
  return {
    ...targetAttempt,
    fallbackTargetId: normalizedFallbackPersonId,
    fallbackAttempt,
    fallbackRequested: fallbackAttempt.requested,
  };
}

async function getFotosSyncState(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => {
    if (typeof window.__fotosDebug.getFotosSyncState === 'function') {
      return window.__fotosDebug.getFotosSyncState();
    }

    return window.__fotosDebug.getShareState();
  }, undefined, timeoutMs);
}

async function getShareState(page, timeoutMs = READY_TIMEOUT_MS) {
  return await getFotosSyncState(page, timeoutMs);
}

async function getGalleryState(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getGalleryState(), undefined, timeoutMs);
}

function galleryHasItem(galleryState, fileName) {
  return Boolean(galleryState?.items?.some(item => item?.name === fileName));
}

function shareStateHasImportedEntry(syncState, fileName) {
  return Boolean(syncState?.importedEntries?.some(entry => entry?.name === fileName));
}

function shareStateHasSharedItem(syncState, fileName) {
  return Boolean(syncState?.sharedItems?.some(item => item?.name === fileName));
}

function syncStateHasManifestEntry(syncState, fileName) {
  return Boolean(
    syncState?.manifestEntries?.some(entry => entry?.name === fileName)
    || syncState?.manifest?.resolvedEntries?.some(entry => entry?.name === fileName),
  );
}

function shareStateHasProjectedRemoteItem(syncState, fileName) {
  return Boolean(
    syncState?.remoteItems?.some(item => item?.name === fileName)
    || syncState?.importedEntries?.some(entry =>
      entry?.name === fileName && entry?.projected && entry?.sourceKind === 'remote',
    ),
  );
}

function shareStateHasGrantedPeer(syncState, personId) {
  return Boolean(syncState?.grantedPeerIds?.includes(personId));
}

function createPeerConnectionRefresher(
  pages,
  page1TargetId,
  page2TargetId,
  minIntervalMs = 2_000,
) {
  let lastAttemptAt = 0;
  let attemptCount = 0;

  return async ({ force = false, label = 'peer-refresh' } = {}) => {
    const now = Date.now();
    if (!force && now - lastAttemptAt < minIntervalMs) {
      return null;
    }

    lastAttemptAt = now;
    attemptCount += 1;

    const settled = await Promise.allSettled([
      requestPeerConnection(pages[0], page2TargetId),
      requestPeerConnection(pages[1], page1TargetId),
    ]);

    const summary = settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          page: index + 1,
          ...result.value,
        };
      }

      return {
        page: index + 1,
        requested: false,
        error: getErrorMessage(result.reason),
      };
    });

    if (
      force
      || attemptCount === 1
      || attemptCount % 5 === 0
      || summary.some(result => result.error)
    ) {
      console.log(`[${label}] request results:`, JSON.stringify(summary, null, 2));
    }

    return summary;
  };
}

function presenceIncludesPeer(snapshot, peerId) {
  return Boolean(snapshot?.resolvedEntries?.some(entry => entry?.personId === peerId));
}

function detectMimeType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    default:
      return 'application/octet-stream';
  }
}

function materializeUniqueFixtureVariant(sourcePath, outputDir, targetBaseName) {
  mkdirSync(outputDir, { recursive: true });
  const targetPath = join(outputDir, `${targetBaseName}${extname(sourcePath)}`);
  const originalBytes = readFileSync(sourcePath);
  const uniquenessMarker = Buffer.from(
    `\nFOTOS-ID-SHARE-VARIANT:${basename(sourcePath)}:${targetBaseName}\n`,
    'utf8',
  );

  writeFileSync(targetPath, Buffer.concat([originalBytes, uniquenessMarker]));
  return targetPath;
}

async function installSeededFolderPicker(page, label, fixturePath, fileName) {
  const payload = {
    bytes: Array.from(readFileSync(fixturePath)),
    dirName: `fotos-id-share-${label}`,
    fileName,
    mimeType: detectMimeType(fixturePath),
  };

  return await page.evaluate(async ({ bytes, dirName, fileName: targetFileName, mimeType }) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(dirName, { create: true });

    for await (const [entryName] of directory.entries()) {
      await directory.removeEntry(entryName, { recursive: true });
    }

    const fileHandle = await directory.getFileHandle(targetFileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();

    window.__fotosTestGalleryHandle = directory;
    window.showDirectoryPicker = async () => directory;

    return {
      directoryName: directory.name,
      fileName: targetFileName,
      mimeType,
    };
  }, payload);
}

async function restoreSeededFolderPicker(page, label) {
  const payload = {
    dirName: `fotos-id-share-${label}`,
  };

  return await page.evaluate(async ({ dirName }) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(dirName, { create: false });
    window.__fotosTestGalleryHandle = directory;
    window.showDirectoryPicker = async () => directory;

    return {
      directoryName: directory.name,
    };
  }, payload);
}

async function ensureSeededFolderPicker(page, label) {
  const hasHandle = await page.evaluate(() => Boolean(window.__fotosTestGalleryHandle)).catch(() => false);
  if (hasHandle) {
    return;
  }

  await restoreSeededFolderPicker(page, label);
}

async function appendFixtureToSeededGallery(page, fixturePath, fileName) {
  const payload = {
    bytes: Array.from(readFileSync(fixturePath)),
    fileName,
  };

  return await page.evaluate(async ({ bytes, fileName: targetFileName }) => {
    const directory = window.__fotosTestGalleryHandle;
    if (!directory) {
      throw new Error('No seeded gallery handle is available');
    }

    const fileHandle = await directory.getFileHandle(targetFileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();

    return targetFileName;
  }, payload);
}

async function isAltTextVisible(page, text) {
  try {
    return await page.getByAltText(text, { exact: true }).first().isVisible();
  } catch {
    return false;
  }
}

async function waitForStage(name, timeoutMs, check, getFailureSnapshot, assertHealthy) {
  const deadline = Date.now() + timeoutMs;
  console.log(`[stage:${name}] waiting`);

  while (Date.now() < deadline) {
    if (assertHealthy) {
      await assertHealthy();
    }

    const result = await check();
    if (result) {
      console.log(`[stage:${name}] passed`);
      return result;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (assertHealthy) {
    await assertHealthy();
  }

  const failureSnapshot = getFailureSnapshot ? await getFailureSnapshot() : null;
  if (failureSnapshot) {
    console.log(`[stage:${name}] failure snapshot:`);
    console.log(JSON.stringify(failureSnapshot, null, 2));
  }

  const error = new Error(`Stage '${name}' timed out after ${timeoutMs}ms`);
  error.failureSnapshot = failureSnapshot;
  error.stageName = name;
  throw error;
}

async function writeReportArtifact(artifactDir, report) {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
}

async function collectFailureArtifacts(pages, artifactDir, report) {
  mkdirSync(artifactDir, { recursive: true });

  await Promise.all(
    pages.map((page, index) =>
      page.screenshot({
        path: join(artifactDir, `page-${index + 1}.png`),
        fullPage: true,
      }).catch(() => undefined),
    ),
  );

  await writeReportArtifact(artifactDir, report);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findVisibleButton(page, pattern) {
  const buttons = page.locator('button');
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const text = (await candidate.innerText().catch(() => '')).trim();
    if (pattern.test(text)) {
      return candidate;
    }
  }

  throw new Error(`Could not find visible button matching ${pattern}`);
}

async function hasVisibleButton(page, pattern) {
  try {
    await findVisibleButton(page, pattern);
    return true;
  } catch {
    return false;
  }
}

async function clickVisibleButton(page, pattern) {
  const button = await findVisibleButton(page, pattern);
  await button.click();
}

async function openSidebarTab(page, label) {
  await clickVisibleButton(page, new RegExp(`^${escapeRegex(label)}$`, 'i'));
}

async function captureShareFieldState(page) {
  const input = page.getByPlaceholder('Add glue contact, name, @identity, or person id').first();
  const addButton = input.locator('xpath=following-sibling::button[1]');
  const removeButtons = page.locator('button[aria-label^="Remove "]');
  const listId = await input.getAttribute('list').catch(() => null);
  const optionValues = listId
    ? await page.locator(`#${listId} option`).evaluateAll(elements =>
      elements.map(element => element.getAttribute('value')),
    ).catch(() => [])
    : [];
  const errorMessage = await input.evaluate(node => {
    const container = node.closest('.space-y-2');
    if (!container) {
      return null;
    }

    const message = Array.from(container.querySelectorAll('div'))
      .map(element => element.textContent?.trim() ?? '')
      .find(text =>
        text.length > 0
        && (
          text.includes('No matching glue identity')
          || text.includes('already selected')
        ),
      );
    return message ?? null;
  }).catch(() => null);

  return {
    draft: await input.inputValue().catch(() => null),
    addDisabled: await addButton.isDisabled().catch(() => null),
    optionValues,
    errorMessage,
    removeLabels: await removeButtons.evaluateAll(elements =>
      elements.map(element => element.getAttribute('aria-label')),
    ).catch(() => []),
    sharePeerOptions: await getSharePeerOptions(page, 5_000).catch(() => []),
    shareState: await getShareState(page, 5_000).catch(() => null),
  };
}

async function fetchRegistrationCheck(apiBase, identity) {
  const response = await fetch(`${apiBase}/api/registration/check/${encodeURIComponent(identity)}`);
  if (!response.ok) {
    throw new Error(`Registration check failed for ${identity}: ${response.status}`);
  }

  return await response.json();
}

async function ensureGalleryOpenWithFixture(page, label, fixturePath, fileName) {
  const initialStatus = await getStatus(page, 5_000).catch(() => null);
  const initialGalleryState = await getGalleryState(page, 5_000).catch(() => null);
  if (initialStatus?.isOpen && galleryHasItem(initialGalleryState, fileName)) {
    await ensureSeededFolderPicker(page, label);
    return;
  }

  await installSeededFolderPicker(page, label, fixturePath, fileName);
  await clickVisibleButton(page, OPEN_FOLDER_BUTTON_PATTERN);

  await waitForStage(
    `${label}-local-gallery`,
    READY_TIMEOUT_MS,
    async () => {
      const [status, galleryState] = await Promise.all([
        getStatus(page, 5_000),
        getGalleryState(page, 5_000),
      ]);
      return (
        status?.isOpen
        && galleryHasItem(galleryState, fileName)
      )
        ? { status, galleryState }
        : false;
    },
  );
}

async function prepareAndRegisterIdentity(page, label, displayName, apiBase) {
  const prepared = await prepareIdentity(page, displayName);
  if (prepared.reloadRequired) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDebugApi(page, READY_TIMEOUT_MS);
  }

  await waitForStage(
    `${label}-prepared-identity`,
    READY_TIMEOUT_MS,
    async () => {
      const snapshot = await getLocalIdentitySnapshot(page, 5_000);
      return snapshot?.syncEnabled && snapshot?.publicationIdentity
        ? snapshot
        : false;
    },
  );

  const registration = await registerPreparedIdentity(page, displayName);
  const glueIdentity = toGlueIdentity(displayName);
  await waitForStage(
    `${label}-registered-name`,
    READY_TIMEOUT_MS,
    async () => {
      const result = await fetchRegistrationCheck(apiBase, glueIdentity);
      return result?.available === false ? result : false;
    },
  );

  return registration;
}

async function appendSharedFixtureAndRescan(page, label, fixturePath, fileName) {
  await ensureSeededFolderPicker(page, label);
  await appendFixtureToSeededGallery(page, fixturePath, fileName);
  await openSidebarTab(page, 'Manage');
  await clickVisibleButton(page, RESCAN_BUTTON_PATTERN);
}

async function addGalleryShareByName(page, targetDisplayName, expectedPersonId, stageName) {
  await openSidebarTab(page, 'Manage');
  const input = page.getByPlaceholder('Add glue contact, name, @identity, or person id').first();
  const addButton = input.locator('xpath=following-sibling::button[1]');
  await input.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
  await addButton.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });

  await waitForStage(
    `${stageName}-token-resolves`,
    10_000,
    async () => {
      const resolution = await resolveShareToken(page, targetDisplayName, 5_000).catch(() => null);
      return resolution?.personId === expectedPersonId ? resolution : false;
    },
    async () => ({
      shareFieldState: await captureShareFieldState(page),
      resolution: await resolveShareToken(page, targetDisplayName, 5_000).catch(() => null),
    }),
  );

  await input.fill(targetDisplayName);

  await waitForStage(
    `${stageName}-draft-ready`,
    10_000,
    async () => {
      const [draft, addDisabled] = await Promise.all([
        input.inputValue(),
        addButton.isDisabled(),
      ]);
      return draft === targetDisplayName && !addDisabled
        ? { draft, addDisabled }
        : false;
    },
    async () => await captureShareFieldState(page),
  );

  await addButton.click();

  await waitForStage(
    stageName,
    SHARE_TIMEOUT_MS,
    async () => {
      const shareState = await getShareState(page, 5_000);
      return shareStateHasGrantedPeer(shareState, expectedPersonId) ? shareState : false;
    },
    async () => await captureShareFieldState(page),
  );
}

async function main() {
  for (const fixturePath of [FIXTURE_A, FIXTURE_B]) {
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture not found at ${fixturePath}`);
    }
  }

  const playwrightModule = await loadPlaywright();
  const baseUrl = process.env.FOTOS_LIVE_URL || DEFAULT_BASE_URL;
  const apiBase = process.env.FOTOS_LIVE_API_BASE || DEFAULT_API_BASE;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const headless = process.env.HEADLESS !== 'false';
  const artifactDir = join(os.tmpdir(), `fotos-id-share-${suffix}`);
  const derivedFixtureDir = join(artifactDir, 'fixtures');
  const seedFixtures = {
    page1: FIXTURE_B,
    page2: FIXTURE_A,
  };
  const sharedFixtures = {
    aToB: materializeUniqueFixtureVariant(FIXTURE_A, derivedFixtureDir, `share-a-${suffix}`),
    bToA: materializeUniqueFixtureVariant(FIXTURE_B, derivedFixtureDir, `share-b-${suffix}`),
  };
  const initialFileNames = {
    page1: `seed-a-${suffix}${extname(seedFixtures.page1)}`,
    page2: `seed-b-${suffix}${extname(seedFixtures.page2)}`,
  };
  const sharedFileNames = {
    aToB: `share-a-${suffix}${extname(sharedFixtures.aToB)}`,
    bToA: `share-b-${suffix}${extname(sharedFixtures.bToA)}`,
  };
  const displayNames = {
    a: `Fotos Alice ${suffix}`,
    b: `Fotos Bob ${suffix}`,
  };
  const report = {
    baseUrl,
    apiBase,
    browser: process.env.FOTOS_LIVE_BROWSER || 'chromium',
    artifactDir,
    fixtures: {
      seedPage1: seedFixtures.page1,
      seedPage2: seedFixtures.page2,
      aToB: sharedFixtures.aToB,
      bToA: sharedFixtures.bToA,
    },
    gallerySeeds: initialFileNames,
    sharedFileNames,
    displayNames,
    glueIdentities: {
      page1: toGlueIdentity(displayNames.a),
      page2: toGlueIdentity(displayNames.b),
    },
    peerIds: {
      page1: null,
      page2: null,
    },
    shareTargetIds: {
      page1: null,
      page2: null,
    },
    logs: {
      page1: [],
      page2: [],
    },
    finalState: null,
  };

  const browser = await launchBrowser(playwrightModule, headless);
  const contexts = await Promise.all([
    browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: true }),
    browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: true }),
  ]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  let fatalPageError = null;

  const recordFatalPageError = (pageIndex, message) => {
    if (fatalPageError) {
      return;
    }

    fatalPageError = {
      page: pageIndex + 1,
      message,
    };
  };

  pages.forEach((page, index) => {
    page.on('console', message => {
      const text = message.text();
      if (
        !/\[fotos|\[glue|\[ConnectionModule|\[CHUM|\[openFolder|\[share-target/i.test(text)
        && !['warning', 'error'].includes(message.type())
      ) {
        return;
      }

      report.logs[index === 0 ? 'page1' : 'page2'].push(`[${message.type()}] ${text}`);
      if (/\[fotos\]\s+boot failed:/i.test(text)) {
        recordFatalPageError(index, text);
      }
    });

    page.on('pageerror', error => {
      const message = getErrorMessage(error);
      report.logs[index === 0 ? 'page1' : 'page2'].push(`[pageerror] ${message}`);
      recordFatalPageError(index, `[pageerror] ${message}`);
    });
  });

  const captureSnapshot = async () => {
    const identities = await Promise.all(pages.map(page => getLocalIdentitySnapshot(page).catch(() => null)));
    const statuses = await Promise.all(pages.map(page => getStatus(page).catch(() => null)));
    const presence = await Promise.all(pages.map(page => getPresenceSnapshot(page).catch(() => null)));
    const peers = await Promise.all(pages.map(page => getOnlinePeers(page).catch(() => [])));
    const sharePeerOptions = await Promise.all(pages.map(page => getSharePeerOptions(page).catch(() => [])));
    const wantedPeerIds = await Promise.all(pages.map(page => getWantedPeerIds(page).catch(() => [])));
    const connectablePeerIds = await Promise.all(pages.map(page => getConnectablePeerIds(page).catch(() => [])));
    const coordinatorDebug = await Promise.all(
      pages.map(page => getPeerConnectionCoordinatorDebug(page).catch(() => [])),
    );
    const shareStates = await Promise.all(pages.map(page => getShareState(page).catch(() => null)));
    const galleryStates = await Promise.all(pages.map(page => getGalleryState(page).catch(() => null)));
    const peerIdA = identities[0]?.publicationIdentity ?? null;
    const peerIdB = identities[1]?.publicationIdentity ?? null;
    const page1ConnectionTargetId = report.shareTargetIds.page1 ?? peerIdB;
    const page2ConnectionTargetId = report.shareTargetIds.page2 ?? peerIdA;
    const connectionInfo = await Promise.all([
      page1ConnectionTargetId
        ? getPeerConnectionInfo(pages[0], page1ConnectionTargetId).catch(() => null)
        : Promise.resolve(null),
      page2ConnectionTargetId
        ? getPeerConnectionInfo(pages[1], page2ConnectionTargetId).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      statuses,
      identities,
      presence,
      peers,
      sharePeerOptions,
      wantedPeerIds,
      connectablePeerIds,
      coordinatorDebug,
      shareStates,
      galleryStates,
      connectionInfo,
      logs: report.logs,
    };
  };

  try {
    await Promise.all([
      pages[0].goto(buildUrl(baseUrl, 'a'), { waitUntil: 'domcontentloaded' }),
      pages[1].goto(buildUrl(baseUrl, 'b'), { waitUntil: 'domcontentloaded' }),
    ]);

    await waitForStage(
      'debug-ready',
      READY_TIMEOUT_MS,
      async () => {
        await Promise.all(pages.map(page => waitForDebugApi(page, 5_000)));
        return true;
      },
      captureSnapshot,
      async () => {
        if (!fatalPageError) {
          return;
        }

        const failureSnapshot = await captureSnapshot().catch(() => null);
        const error = new Error(
          `Fatal browser error on page ${fatalPageError.page}: ${fatalPageError.message}`,
        );
        error.failureSnapshot = failureSnapshot;
        error.stageName = 'debug-ready';
        throw error;
      },
    );

    await Promise.all([
      ensureGalleryOpenWithFixture(pages[0], 'page1', seedFixtures.page1, initialFileNames.page1),
      ensureGalleryOpenWithFixture(pages[1], 'page2', seedFixtures.page2, initialFileNames.page2),
    ]);

    await Promise.all([
      prepareAndRegisterIdentity(pages[0], 'page1', displayNames.a, apiBase),
      prepareAndRegisterIdentity(pages[1], 'page2', displayNames.b, apiBase),
    ]);

    await Promise.all([
      ensureGalleryOpenWithFixture(pages[0], 'page1', seedFixtures.page1, initialFileNames.page1),
      ensureGalleryOpenWithFixture(pages[1], 'page2', seedFixtures.page2, initialFileNames.page2),
    ]);

    await waitForStage(
      'sync-ready',
      READY_TIMEOUT_MS,
      async () => {
        const identities = await Promise.all(pages.map(page => getLocalIdentitySnapshot(page, 5_000)));
        const statuses = await Promise.all(pages.map(page => getStatus(page, 5_000)));
        return identities.every(identity => Boolean(identity?.publicationIdentity))
          && statuses.every(status => Boolean(status?.headlessConnected))
          ? { identities, statuses }
          : false;
      },
      captureSnapshot,
    );

    const identities = await Promise.all(pages.map(page => getLocalIdentitySnapshot(page)));
    const page1PeerId = identities[0]?.publicationIdentity;
    const page2PeerId = identities[1]?.publicationIdentity;
    if (!page1PeerId || !page2PeerId) {
      throw new Error('Missing publication identities after authentication');
    }
    const page1ShareTargetId = page2PeerId;
    const page2ShareTargetId = page1PeerId;
    const refreshPeerConnections = createPeerConnectionRefresher(
      pages,
      page1ShareTargetId,
      page2ShareTargetId,
      Math.max(POLL_INTERVAL_MS * 2, 2_000),
    );
    report.peerIds.page1 = page1PeerId;
    report.peerIds.page2 = page2PeerId;
    report.shareTargetIds.page1 = page1ShareTargetId;
    report.shareTargetIds.page2 = page2ShareTargetId;

    await addGalleryShareByName(pages[0], displayNames.b, page1ShareTargetId, 'page1-share-by-name');
    await addGalleryShareByName(pages[1], displayNames.a, page2ShareTargetId, 'page2-share-by-name');

    await waitForStage(
      'share-demand-ready',
      SHARE_TIMEOUT_MS,
      async () => {
        const [
          page1WantedPeerIds,
          page2WantedPeerIds,
          page1CoordinatorDebug,
          page2CoordinatorDebug,
        ] = await Promise.all([
          getWantedPeerIds(pages[0], 5_000),
          getWantedPeerIds(pages[1], 5_000),
          getPeerConnectionCoordinatorDebug(pages[0], 5_000),
          getPeerConnectionCoordinatorDebug(pages[1], 5_000),
        ]);

        const page1DemandReady = page1WantedPeerIds.includes(page1ShareTargetId)
          && page1CoordinatorDebug.some(peer =>
            peer.personId === page1ShareTargetId && peer.isDemandedPeer,
          );
        const page2DemandReady = page2WantedPeerIds.includes(page2ShareTargetId)
          && page2CoordinatorDebug.some(peer =>
            peer.personId === page2ShareTargetId && peer.isDemandedPeer,
          );

        return page1DemandReady && page2DemandReady
          ? {
              page1WantedPeerIds,
              page2WantedPeerIds,
              page1CoordinatorDebug,
              page2CoordinatorDebug,
            }
          : false;
      },
      captureSnapshot,
    );

    await refreshPeerConnections({ force: true, label: 'peer-connection' });

    await waitForStage(
      'peer-connection',
      CONNECTION_TIMEOUT_MS,
      async () => {
        const [infoA, infoB] = await Promise.all([
          getPeerConnectionInfo(pages[0], page1ShareTargetId, 5_000),
          getPeerConnectionInfo(pages[1], page2ShareTargetId, 5_000),
        ]);

        return (infoA?.online || infoA?.coordinatorState) && (infoB?.online || infoB?.coordinatorState)
          ? { infoA, infoB }
          : false;
      },
      captureSnapshot,
      refreshPeerConnections,
    );

    await appendSharedFixtureAndRescan(pages[0], 'page1', sharedFixtures.aToB, sharedFileNames.aToB);
    await waitForStage(
      'photo-local-gallery-a',
      SHARE_TIMEOUT_MS,
      async () => {
        const galleryState = await getGalleryState(pages[0], 5_000);
        return galleryHasItem(galleryState, sharedFileNames.aToB) ? galleryState : false;
      },
      captureSnapshot,
    );

    await waitForStage(
      'photo-local-manifest-a',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(pages[0], 5_000);
        return syncStateHasManifestEntry(syncState, sharedFileNames.aToB)
          && shareStateHasSharedItem(syncState, sharedFileNames.aToB)
          ? syncState
          : false;
      },
      captureSnapshot,
    );

    await refreshPeerConnections({ force: true, label: 'photo-a-to-b-refresh' });

    await waitForStage(
      'photo-object-a-to-b',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(pages[1], 5_000);
        return shareStateHasImportedEntry(syncState, sharedFileNames.aToB)
          ? syncState
          : false;
      },
      captureSnapshot,
      refreshPeerConnections,
    );

    await waitForStage(
      'photo-gallery-a-to-b',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(pages[1], 5_000);
        return shareStateHasProjectedRemoteItem(syncState, sharedFileNames.aToB)
          ? syncState
          : false;
      },
      captureSnapshot,
      refreshPeerConnections,
    );

    await waitForStage(
      'photo-dom-a-to-b',
      SHARE_TIMEOUT_MS,
      async () => await isAltTextVisible(pages[1], sharedFileNames.aToB),
      captureSnapshot,
      refreshPeerConnections,
    );

    await appendSharedFixtureAndRescan(pages[1], 'page2', sharedFixtures.bToA, sharedFileNames.bToA);
    await waitForStage(
      'photo-local-gallery-b',
      SHARE_TIMEOUT_MS,
      async () => {
        const galleryState = await getGalleryState(pages[1], 5_000);
        return galleryHasItem(galleryState, sharedFileNames.bToA) ? galleryState : false;
      },
      captureSnapshot,
    );

    await waitForStage(
      'photo-local-manifest-b',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(pages[1], 5_000);
        return syncStateHasManifestEntry(syncState, sharedFileNames.bToA)
          && shareStateHasSharedItem(syncState, sharedFileNames.bToA)
          ? syncState
          : false;
      },
      captureSnapshot,
    );

    await refreshPeerConnections({ force: true, label: 'photo-b-to-a-refresh' });

    await waitForStage(
      'photo-object-b-to-a',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(pages[0], 5_000);
        return shareStateHasImportedEntry(syncState, sharedFileNames.bToA)
          ? syncState
          : false;
      },
      captureSnapshot,
      refreshPeerConnections,
    );

    await waitForStage(
      'photo-gallery-b-to-a',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(pages[0], 5_000);
        return shareStateHasProjectedRemoteItem(syncState, sharedFileNames.bToA)
          ? syncState
          : false;
      },
      captureSnapshot,
      refreshPeerConnections,
    );

    await waitForStage(
      'photo-dom-b-to-a',
      SHARE_TIMEOUT_MS,
      async () => await isAltTextVisible(pages[0], sharedFileNames.bToA),
      captureSnapshot,
      refreshPeerConnections,
    );

    report.finalState = await captureSnapshot();
    await writeReportArtifact(artifactDir, report);
    console.log(`[fotos-id-share] report written to ${join(artifactDir, 'report.json')}`);
  } catch (error) {
    report.error = getErrorMessage(error);
    report.finalState = await captureSnapshot().catch(() => null);
    await collectFailureArtifacts(pages, artifactDir, report);
    throw error;
  } finally {
    await Promise.allSettled(
      contexts.map(context => settleWithin(context.close(), 5_000)),
    );
    await settleWithin(browser.close().catch(() => undefined), 5_000);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
