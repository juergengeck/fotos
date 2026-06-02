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
const DEFAULT_BASE_URL_A = 'http://localhost:3101/';
const DEFAULT_BASE_URL_B = 'http://localhost:3102/';
const READY_TIMEOUT_MS = Number(process.env.FOTOS_ADHOC_READY_TIMEOUT_MS || 180_000);
const CONNECTION_TIMEOUT_MS = Number(process.env.FOTOS_ADHOC_CONNECTION_TIMEOUT_MS || 120_000);
const SHARE_TIMEOUT_MS = Number(process.env.FOTOS_ADHOC_SHARE_TIMEOUT_MS || 180_000);
const SNAPSHOT_TIMEOUT_MS = Number(process.env.FOTOS_ADHOC_SNAPSHOT_TIMEOUT_MS || 2_000);
const POLL_INTERVAL_MS = Number(process.env.FOTOS_ADHOC_POLL_MS || 1_000);
const DEFAULT_FIXTURE = resolve(
  REPO_ROOT,
  'fotos.browser/browser-ui/src/lib/__fixtures__/photos/rose-top-left.jpg',
);
const FIXTURE = process.env.FOTOS_ADHOC_FIXTURE?.trim() || DEFAULT_FIXTURE;
const OPEN_FOLDER_BUTTON_PATTERN = /^Open photo folder$/i;

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

async function launchRoleContext(playwrightModule, role, baseUrl, headless, artifactDir) {
  const playwright = playwrightModule.default ?? playwrightModule;
  const browserName = process.env.FOTOS_ADHOC_BROWSER || 'chromium';
  const browserType = playwright[browserName];

  if (!browserType) {
    throw new Error(`Unsupported Playwright browser '${browserName}'`);
  }

  const userDataDir = join(artifactDir, `${role}-profile`);
  const context = await browserType.launchPersistentContext(userDataDir, {
    headless,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    viewport: { width: 720, height: 920 },
    args: [
      '--window-size=720,920',
      role === 'sender' ? '--window-position=30,40' : '--window-position=780,40',
    ],
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(READY_TIMEOUT_MS);

  return {
    context,
    page,
    baseUrl,
    role,
  };
}

function buildUrl(baseUrl, pageLabel) {
  const url = new URL(baseUrl);
  url.searchParams.set('fotosDebug', '1');
  url.searchParams.set('page', pageLabel);
  return url.toString();
}

function rewriteInviteUrlForRecipient(inviteUrl, recipientBaseUrl) {
  const source = new URL(inviteUrl);
  const target = new URL(recipientBaseUrl);
  target.search = source.search;
  target.hash = source.hash;
  target.searchParams.set('page', 'recipient');
  return target.toString();
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

async function createGalleryShareInvite(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async () => {
    return await window.__fotosDebug.createGalleryShareInvite();
  }, undefined, timeoutMs);
}

async function acceptGalleryShareInvite(page, pin, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async targetPin => {
    return await window.__fotosDebug.acceptGalleryShareInvite(targetPin);
  }, pin, timeoutMs);
}

async function getFotosSyncState(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getFotosSyncState(), undefined, timeoutMs);
}

async function getGalleryState(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getGalleryState(), undefined, timeoutMs);
}

async function getPeerConnectionInfo(page, personId, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, targetPersonId => {
    return window.__fotosDebug.getPeerConnectionInfo(targetPersonId);
  }, personId, timeoutMs);
}

async function requestPeerConnection(page, personId, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, targetPersonId => {
    if (typeof window.__fotosDebug.requestPeerConnection !== 'function') {
      return null;
    }

    return window.__fotosDebug.requestPeerConnection(targetPersonId);
  }, personId, timeoutMs);
}

async function forceRouteKeyConnect(page, personId, keySource = 'advertised', timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async ({ targetPersonId, targetKeySource }) => {
    if (typeof window.__fotosDebug.forceRouteKeyConnect !== 'function') {
      return null;
    }

    return await window.__fotosDebug.forceRouteKeyConnect(targetPersonId, targetKeySource);
  }, { targetPersonId: personId, targetKeySource: keySource }, timeoutMs);
}

async function getAccessibleRootSummary(page, personId, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async targetPersonId => {
    if (typeof window.__fotosDebug.getAccessibleRootSummary !== 'function') {
      return null;
    }

    return await window.__fotosDebug.getAccessibleRootSummary(targetPersonId);
  }, personId, timeoutMs);
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
    `\nFOTOS-ADHOC-SHARE-VARIANT:${basename(sourcePath)}:${targetBaseName}\n`,
    'utf8',
  );

  writeFileSync(targetPath, Buffer.concat([originalBytes, uniquenessMarker]));
  return targetPath;
}

async function installSeededFolderPicker(page, label, fixturePath, fileName) {
  const payload = {
    bytes: Array.from(readFileSync(fixturePath)),
    dirName: `fotos-adhoc-share-${label}`,
    fileName,
    mimeType: detectMimeType(fixturePath),
  };

  return await page.evaluate(async ({ bytes, dirName, fileName: targetFileName }) => {
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
    };
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

async function collectFailureArtifacts(roles, artifactDir, report) {
  mkdirSync(artifactDir, { recursive: true });

  await Promise.all(
    roles.map(role =>
      role.page.screenshot({
        path: join(artifactDir, `${role.role}.png`),
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

async function clickVisibleButton(page, pattern) {
  const button = await findVisibleButton(page, pattern);
  await button.click();
}

async function openSidebarTab(page, label) {
  await clickVisibleButton(page, new RegExp(`^${escapeRegex(label)}$`, 'i'));
}

async function ensureGalleryOpenWithFixture(page, label, fixturePath, fileName) {
  const initialStatus = await getStatus(page, 5_000).catch(() => null);
  const initialGalleryState = await getGalleryState(page, 5_000).catch(() => null);
  if (initialStatus?.isOpen && galleryHasItem(initialGalleryState, fileName)) {
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

async function prepareSenderIdentity(page, displayName) {
  const prepared = await prepareIdentity(page, displayName);
  if (prepared.reloadRequired) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDebugApi(page, READY_TIMEOUT_MS);
  }

  await waitForStage(
    'sender-prepared-identity',
    READY_TIMEOUT_MS,
    async () => {
      const snapshot = await getLocalIdentitySnapshot(page, 5_000);
      return snapshot?.syncEnabled && snapshot?.publicationIdentity
        ? snapshot
        : false;
    },
  );
}

async function main() {
  if (!existsSync(FIXTURE)) {
    throw new Error(`Fixture not found at ${FIXTURE}`);
  }

  const playwrightModule = await loadPlaywright();
  const baseUrlA = process.env.FOTOS_ADHOC_SHARE_URL_A || DEFAULT_BASE_URL_A;
  const baseUrlB = process.env.FOTOS_ADHOC_SHARE_URL_B || DEFAULT_BASE_URL_B;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const headless = process.env.HEADLESS === 'true';
  const artifactDir = join(os.tmpdir(), `fotos-adhoc-gallery-share-${suffix}`);
  const derivedFixtureDir = join(artifactDir, 'fixtures');
  const sharedFixture = materializeUniqueFixtureVariant(FIXTURE, derivedFixtureDir, `adhoc-share-${suffix}`);
  const sharedFileName = `adhoc-share-${suffix}${extname(sharedFixture)}`;
  const senderDisplayName = `Fotos Sender ${suffix}`;
  const report = {
    baseUrlA,
    baseUrlB,
    browser: process.env.FOTOS_ADHOC_BROWSER || 'chromium',
    headless,
    artifactDir,
    fixture: sharedFixture,
    sharedFileName,
    senderDisplayName,
    senderPersonId: null,
    guestPersonId: null,
    invite: null,
    logs: {
      sender: [],
      recipient: [],
    },
    finalState: null,
  };

  let fatalPageError = null;
  const roles = await Promise.all([
    launchRoleContext(playwrightModule, 'sender', baseUrlA, headless, artifactDir),
    launchRoleContext(playwrightModule, 'recipient', baseUrlB, headless, artifactDir),
  ]);
  const [sender, recipient] = roles;

  const recordFatalPageError = (role, message) => {
    if (fatalPageError) {
      return;
    }

    fatalPageError = { role, message };
  };

  roles.forEach(role => {
    role.page.on('console', message => {
      const text = message.text();
      if (
        !/\[fotos|\[glue|\[ConnectionModule|\[CHUM|\[openFolder|\[share-target/i.test(text)
        && !['warning', 'error'].includes(message.type())
      ) {
        return;
      }

      report.logs[role.role].push(`[${message.type()}] ${text}`);
      if (/\[fotos\]\s+boot failed:/i.test(text)) {
        recordFatalPageError(role.role, text);
      }
    });

    role.page.on('pageerror', error => {
      const message = getErrorMessage(error);
      report.logs[role.role].push(`[pageerror] ${message}`);
      recordFatalPageError(role.role, `[pageerror] ${message}`);
    });
  });

  const captureSnapshot = async () => {
    const identities = await Promise.all(roles.map(role => getLocalIdentitySnapshot(role.page, SNAPSHOT_TIMEOUT_MS).catch(() => null)));
    const statuses = await Promise.all(roles.map(role => getStatus(role.page, SNAPSHOT_TIMEOUT_MS).catch(() => null)));
    const shareStates = await Promise.all(roles.map(role => getFotosSyncState(role.page, SNAPSHOT_TIMEOUT_MS).catch(() => null)));
    const galleryStates = await Promise.all(roles.map(role => getGalleryState(role.page, SNAPSHOT_TIMEOUT_MS).catch(() => null)));
    const senderPersonId = identities[0]?.publicationIdentity ?? report.senderPersonId;
    const guestPersonId = identities[1]?.publicationIdentity ?? report.guestPersonId;
    const connectionInfo = await Promise.all([
      guestPersonId
        ? getPeerConnectionInfo(sender.page, guestPersonId, SNAPSHOT_TIMEOUT_MS).catch(() => null)
        : Promise.resolve(null),
      senderPersonId
        ? getPeerConnectionInfo(recipient.page, senderPersonId, SNAPSHOT_TIMEOUT_MS).catch(() => null)
        : Promise.resolve(null),
    ]);
    const accessibleRoots = await Promise.all([
      guestPersonId
        ? getAccessibleRootSummary(sender.page, guestPersonId, SNAPSHOT_TIMEOUT_MS).catch(() => null)
        : Promise.resolve(null),
      senderPersonId
        ? getAccessibleRootSummary(recipient.page, senderPersonId, SNAPSHOT_TIMEOUT_MS).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      statuses,
      identities,
      shareStates,
      galleryStates,
      connectionInfo,
      accessibleRoots,
      logs: report.logs,
    };
  };

  const assertHealthy = async () => {
    if (!fatalPageError) {
      return;
    }

    const failureSnapshot = await captureSnapshot().catch(() => null);
    const error = new Error(
      `Fatal browser error on ${fatalPageError.role}: ${fatalPageError.message}`,
    );
    error.failureSnapshot = failureSnapshot;
    error.stageName = 'browser-health';
    throw error;
  };

  try {
    await sender.page.goto(buildUrl(sender.baseUrl, 'sender'), { waitUntil: 'domcontentloaded' });
    await waitForStage(
      'sender-debug-ready',
      READY_TIMEOUT_MS,
      async () => {
        await waitForDebugApi(sender.page, 5_000);
        return true;
      },
      captureSnapshot,
      assertHealthy,
    );

    await ensureGalleryOpenWithFixture(sender.page, 'sender', sharedFixture, sharedFileName);
    await prepareSenderIdentity(sender.page, senderDisplayName);
    await ensureGalleryOpenWithFixture(sender.page, 'sender', sharedFixture, sharedFileName);

    await waitForStage(
      'sender-sync-ready',
      READY_TIMEOUT_MS,
      async () => {
        const [identity, status] = await Promise.all([
          getLocalIdentitySnapshot(sender.page, 5_000),
          getStatus(sender.page, 5_000),
        ]);
        return identity?.publicationIdentity && status?.headlessConnected
          ? { identity, status }
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    const senderIdentity = await getLocalIdentitySnapshot(sender.page);
    report.senderPersonId = senderIdentity.publicationIdentity;

    const invite = await createGalleryShareInvite(sender.page);
    report.invite = {
      url: invite.url,
      recipientUrl: rewriteInviteUrlForRecipient(invite.url, recipient.baseUrl),
      pin: invite.pin,
      expiresAt: invite.expiresAt,
    };

    await recipient.page.goto(report.invite.recipientUrl, { waitUntil: 'domcontentloaded' });
    await waitForStage(
      'recipient-debug-ready',
      READY_TIMEOUT_MS,
      async () => {
        await waitForDebugApi(recipient.page, 5_000);
        return true;
      },
      captureSnapshot,
      assertHealthy,
    );

    await acceptGalleryShareInvite(recipient.page, invite.pin);
    await waitForStage(
      'recipient-ad-hoc-identity',
      READY_TIMEOUT_MS,
      async () => {
        const identity = await getLocalIdentitySnapshot(recipient.page, 5_000);
        const status = await getStatus(recipient.page, 5_000);
        return identity?.syncEnabled && identity?.publicationIdentity && status?.headlessConnected
          ? { identity, status }
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    const guestIdentity = await getLocalIdentitySnapshot(recipient.page);
    report.guestPersonId = guestIdentity.publicationIdentity;

    await waitForStage(
      'sender-granted-manifest-ready',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(sender.page, 5_000);
        return syncState?.grantedPeerIds?.includes(report.guestPersonId)
          && syncStateHasManifestEntry(syncState, sharedFileName)
          && shareStateHasSharedItem(syncState, sharedFileName)
          ? syncState
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    await waitForStage(
      'adhoc-peer-connection',
      CONNECTION_TIMEOUT_MS,
      async () => {
        const [senderInfo, recipientInfo] = await Promise.all([
          getPeerConnectionInfo(sender.page, report.guestPersonId, 5_000),
          getPeerConnectionInfo(recipient.page, report.senderPersonId, 5_000),
        ]);

        return (senderInfo?.online || senderInfo?.coordinatorState)
          && (recipientInfo?.online || recipientInfo?.coordinatorState)
          ? { senderInfo, recipientInfo }
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    await waitForStage(
      'adhoc-peer-routing-key',
      CONNECTION_TIMEOUT_MS,
      async () => {
        const [senderInfo, recipientInfo] = await Promise.all([
          getPeerConnectionInfo(sender.page, report.guestPersonId, 5_000),
          getPeerConnectionInfo(recipient.page, report.senderPersonId, 5_000),
        ]);

        return senderInfo?.advertisedEncryptionKey && recipientInfo?.advertisedEncryptionKey
          ? { senderInfo, recipientInfo }
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    report.routeKeyDialResults = await Promise.all([
      forceRouteKeyConnect(sender.page, report.guestPersonId, 'advertised', 10_000),
      forceRouteKeyConnect(recipient.page, report.senderPersonId, 'advertised', 10_000),
    ]);
    report.postGrantAccessibleRoots = await Promise.all([
      getAccessibleRootSummary(sender.page, report.guestPersonId, 10_000),
      getAccessibleRootSummary(recipient.page, report.senderPersonId, 10_000),
    ]);

    await waitForStage(
      'recipient-imported-photo-object',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(recipient.page, 5_000);
        return shareStateHasImportedEntry(syncState, sharedFileName)
          ? syncState
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    await waitForStage(
      'recipient-projected-gallery-photo',
      SHARE_TIMEOUT_MS,
      async () => {
        const syncState = await getFotosSyncState(recipient.page, 5_000);
        return shareStateHasProjectedRemoteItem(syncState, sharedFileName)
          ? syncState
          : false;
      },
      captureSnapshot,
      assertHealthy,
    );

    await waitForStage(
      'recipient-gallery-dom-photo',
      SHARE_TIMEOUT_MS,
      async () => await isAltTextVisible(recipient.page, sharedFileName),
      captureSnapshot,
      assertHealthy,
    );

    report.finalState = await captureSnapshot();
    await writeReportArtifact(artifactDir, report);
    console.log(`[fotos-adhoc-gallery-share] report written to ${join(artifactDir, 'report.json')}`);
  } catch (error) {
    report.error = getErrorMessage(error);
    report.finalState = await captureSnapshot().catch(() => null);
    await collectFailureArtifacts(roles, artifactDir, report);
    throw error;
  } finally {
    await Promise.allSettled(
      roles.map(role => settleWithin(role.context.close(), 5_000)),
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
