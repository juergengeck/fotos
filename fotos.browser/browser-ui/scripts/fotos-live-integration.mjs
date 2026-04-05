#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const VGER_ROOT = resolve(REPO_ROOT, 'vger');
const DEFAULT_BASE_URL = 'https://fotos.one/';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    const fallbackPath = resolve(VGER_ROOT, 'node_modules/playwright/index.js');
    if (!existsSync(fallbackPath)) {
      throw new Error(
        'Playwright is not installed. Install it in /Users/gecko/src/vger or add it to fotos.browser/browser-ui.',
      );
    }

    return await import(pathToFileURL(fallbackPath).href);
  }
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

async function getPresenceSnapshot(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getPresenceSnapshot(), undefined, timeoutMs);
}

async function getOnlinePeers(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.getOnlinePeers(), undefined, timeoutMs);
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

async function grantFotosAccess(page, personId, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, async targetPersonId => {
    return await window.__fotosDebug.grantFotosAccess(targetPersonId);
  }, personId, timeoutMs);
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

async function openLocalPicker(page, timeoutMs = READY_TIMEOUT_MS) {
  return await evaluateWithDebugApi(page, () => window.__fotosDebug.openLocalPicker(), undefined, timeoutMs);
}

function galleryHasItem(galleryState, fileName) {
  return Boolean(galleryState?.items?.some(item => item?.name === fileName));
}

function shareStateHasItem(shareState, fileName) {
  return Boolean(shareState?.items?.some(item => item?.name === fileName));
}

function shareStateHasRemoteItem(shareState, fileName) {
  return Boolean(shareState?.remoteItems?.some(item => item?.name === fileName));
}

function shareStateHasSharedItem(shareState, fileName) {
  return Boolean(shareState?.sharedItems?.some(item => item?.name === fileName));
}

function syncStateHasManifestEntry(syncState, fileName) {
  return Boolean(
    syncState?.manifestEntries?.some(entry => entry?.name === fileName)
    || syncState?.manifest?.resolvedEntries?.some(entry => entry?.name === fileName),
  );
}

function syncStateHasImportedEntry(syncState, fileName) {
  return Boolean(syncState?.importedEntries?.some(entry => entry?.name === fileName));
}

function syncStateHasProjectedRemoteItem(syncState, fileName) {
  return Boolean(
    syncState?.remoteItems?.some(item => item?.name === fileName)
    || syncState?.importedEntries?.some(entry =>
      entry?.name === fileName && entry?.projected && entry?.sourceKind === 'remote',
    ),
  );
}

function presenceIncludesPeer(snapshot, peerId) {
  return Boolean(snapshot?.resolvedEntries?.some(entry => entry?.personId === peerId));
}

async function uploadFixture(page, fixturePath) {
  await openLocalPicker(page);
  await page.locator('input[type="file"]').first().setInputFiles(fixturePath);
}

async function waitForAltText(page, text, timeoutMs = SHARE_TIMEOUT_MS) {
  await page.getByAltText(text, { exact: true }).first().waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });
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

async function main() {
  for (const fixturePath of [FIXTURE_A, FIXTURE_B]) {
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture not found at ${fixturePath}`);
    }
  }

  const playwrightModule = await loadPlaywright();
  const baseUrl = process.env.FOTOS_LIVE_URL || DEFAULT_BASE_URL;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const headless = process.env.HEADLESS !== 'false';
  const testStartedAt = Date.now();
  const artifactDir = join(os.tmpdir(), `fotos-live-integration-${suffix}`);
  const fixtureNames = {
    aToB: basename(FIXTURE_A),
    bToA: basename(FIXTURE_B),
  };
  const displayNames = {
    a: `Fotos Alice ${suffix}`,
    b: `Fotos Bob ${suffix}`,
  };
  const report = {
    baseUrl,
    browser: process.env.FOTOS_LIVE_BROWSER || 'chromium',
    artifactDir,
    fixtures: {
      aToB: FIXTURE_A,
      bToA: FIXTURE_B,
    },
    displayNames,
    peerIds: {
      page1: null,
      page2: null,
    },
    stageResults: [],
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
      if (!/\[fotos|\[glue|\[ConnectionModule|\[CHUM/i.test(text)) {
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
    const shareStates = await Promise.all(pages.map(page => getShareState(page).catch(() => null)));
    const syncStates = shareStates;
    const galleryStates = await Promise.all(pages.map(page => getGalleryState(page).catch(() => null)));
    const peerIdA = identities[0]?.publicationIdentity ?? null;
    const peerIdB = identities[1]?.publicationIdentity ?? null;
    const connectionInfo = await Promise.all([
      peerIdB ? getPeerConnectionInfo(pages[0], peerIdB).catch(() => null) : Promise.resolve(null),
      peerIdA ? getPeerConnectionInfo(pages[1], peerIdA).catch(() => null) : Promise.resolve(null),
    ]);

    return {
      statuses,
      identities,
      presence,
      peers,
      syncStates,
      shareStates,
      galleryStates,
      connectionInfo,
      logs: report.logs,
    };
  };

  const runStage = async (name, timeoutMs, check) => {
    const startedAt = Date.now();
    const value = await waitForStage(
      name,
      timeoutMs,
      check,
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
        error.stageName = name;
        throw error;
      },
    );
    report.stageResults.push({
      name,
      status: 'passed',
      durationMs: Date.now() - startedAt,
      elapsedMs: Date.now() - testStartedAt,
    });
    return value;
  };

  const getStageCompletion = stageName => {
    return report.stageResults.find(stage => stage.name === stageName)?.elapsedMs ?? null;
  };

  const getStageLag = (earlierStageName, laterStageName) => {
    const earlier = getStageCompletion(earlierStageName);
    const later = getStageCompletion(laterStageName);

    if (earlier === null || later === null) {
      return null;
    }

    return later - earlier;
  };

  try {
    await Promise.all([
      pages[0].goto(buildUrl(baseUrl, 'a'), { waitUntil: 'domcontentloaded' }),
      pages[1].goto(buildUrl(baseUrl, 'b'), { waitUntil: 'domcontentloaded' }),
    ]);

    await runStage('debug-ready', READY_TIMEOUT_MS, async () => {
      await Promise.all(pages.map(page => waitForDebugApi(page, 5_000)));
      return true;
    });

    const prepared = await Promise.all([
      prepareIdentity(pages[0], displayNames.a),
      prepareIdentity(pages[1], displayNames.b),
    ]);

    await Promise.all(prepared.map(async (result, index) => {
      if (!result.reloadRequired) {
        return;
      }

      await pages[index].reload({ waitUntil: 'domcontentloaded' });
      await waitForDebugApi(pages[index], READY_TIMEOUT_MS);
    }));

    await runStage('sync-ready', READY_TIMEOUT_MS, async () => {
      const identities = await Promise.all(pages.map(page => getLocalIdentitySnapshot(page, 5_000)));
      const statuses = await Promise.all(pages.map(page => getStatus(page, 5_000)));
      return identities.every(identity => Boolean(identity?.publicationIdentity))
        && statuses.every(status => Boolean(status?.headlessConnected))
        ? { identities, statuses }
        : false;
    });

    const identities = await Promise.all(pages.map(page => getLocalIdentitySnapshot(page)));
    const page1PeerId = identities[0]?.publicationIdentity;
    const page2PeerId = identities[1]?.publicationIdentity;
    if (!page1PeerId || !page2PeerId) {
      throw new Error('Missing publication identities after sync bootstrap');
    }
    report.peerIds.page1 = page1PeerId;
    report.peerIds.page2 = page2PeerId;

    await runStage('peer-presence', PRESENCE_TIMEOUT_MS, async () => {
      const [presenceA, presenceB, peersA, peersB] = await Promise.all([
        getPresenceSnapshot(pages[0], 5_000),
        getPresenceSnapshot(pages[1], 5_000),
        getOnlinePeers(pages[0], 5_000),
        getOnlinePeers(pages[1], 5_000),
      ]);

      const page1SeesPage2 = presenceIncludesPeer(presenceA, page2PeerId) || peersA.some(peer => peer.personId === page2PeerId);
      const page2SeesPage1 = presenceIncludesPeer(presenceB, page1PeerId) || peersB.some(peer => peer.personId === page1PeerId);
      return page1SeesPage2 && page2SeesPage1
        ? { presenceA, presenceB, peersA, peersB }
        : false;
    });

    await Promise.all([
      forceRouteKeyConnect(pages[0], page2PeerId),
      forceRouteKeyConnect(pages[1], page1PeerId),
    ]);

    await runStage('peer-connection', CONNECTION_TIMEOUT_MS, async () => {
      const [infoA, infoB] = await Promise.all([
        getPeerConnectionInfo(pages[0], page2PeerId, 5_000),
        getPeerConnectionInfo(pages[1], page1PeerId, 5_000),
      ]);

      return (infoA?.online || infoA?.coordinatorState) && (infoB?.online || infoB?.coordinatorState)
        ? { infoA, infoB }
        : false;
    });

    await uploadFixture(pages[0], FIXTURE_A);
    await runStage('photo-local-manifest-a', SHARE_TIMEOUT_MS, async () => {
      const syncState = await getFotosSyncState(pages[0], 5_000);
      return syncStateHasManifestEntry(syncState, fixtureNames.aToB)
        && shareStateHasSharedItem(syncState, fixtureNames.aToB)
        ? syncState
        : false;
    });

    await grantFotosAccess(pages[0], page2PeerId);
    await forceRouteKeyConnect(pages[0], page2PeerId);
    await forceRouteKeyConnect(pages[1], page1PeerId);

    await runStage('photo-object-a-to-b', SHARE_TIMEOUT_MS, async () => {
      const syncState = await getFotosSyncState(pages[1], 5_000);
      return syncStateHasImportedEntry(syncState, fixtureNames.aToB)
        ? syncState
        : false;
    });

    await runStage('photo-gallery-a-to-b', SHARE_TIMEOUT_MS, async () => {
      const syncState = await getFotosSyncState(pages[1], 5_000);
      return syncStateHasProjectedRemoteItem(syncState, fixtureNames.aToB) && syncState?.isOpen
        ? syncState
        : false;
    });
    await runStage('photo-dom-a-to-b', SHARE_TIMEOUT_MS, async () => {
      return await isAltTextVisible(pages[1], fixtureNames.aToB);
    });

    await uploadFixture(pages[1], FIXTURE_B);
    await runStage('photo-local-manifest-b', SHARE_TIMEOUT_MS, async () => {
      const syncState = await getFotosSyncState(pages[1], 5_000);
      return syncStateHasManifestEntry(syncState, fixtureNames.bToA)
        && shareStateHasSharedItem(syncState, fixtureNames.bToA)
        ? syncState
        : false;
    });

    await grantFotosAccess(pages[1], page1PeerId);
    await forceRouteKeyConnect(pages[0], page2PeerId);
    await forceRouteKeyConnect(pages[1], page1PeerId);

    await runStage('photo-object-b-to-a', SHARE_TIMEOUT_MS, async () => {
      const syncState = await getFotosSyncState(pages[0], 5_000);
      return syncStateHasImportedEntry(syncState, fixtureNames.bToA)
        ? syncState
        : false;
    });

    await runStage('photo-gallery-b-to-a', SHARE_TIMEOUT_MS, async () => {
      const syncState = await getFotosSyncState(pages[0], 5_000);
      return syncStateHasProjectedRemoteItem(syncState, fixtureNames.bToA)
        ? syncState
        : false;
    });
    await runStage('photo-dom-b-to-a', SHARE_TIMEOUT_MS, async () => {
      return await isAltTextVisible(pages[0], fixtureNames.bToA);
    });

    await runStage('photo-shared-gallery-stable', SHARE_TIMEOUT_MS, async () => {
      const [page1SyncState, page2SyncState] = await Promise.all([
        getFotosSyncState(pages[0], 5_000),
        getFotosSyncState(pages[1], 5_000),
      ]);

      const page1Stable = shareStateHasSharedItem(page1SyncState, fixtureNames.aToB)
        && syncStateHasProjectedRemoteItem(page1SyncState, fixtureNames.bToA);
      const page2Stable = shareStateHasSharedItem(page2SyncState, fixtureNames.bToA)
        && syncStateHasProjectedRemoteItem(page2SyncState, fixtureNames.aToB);

      return page1Stable && page2Stable
        ? { page1SyncState, page2SyncState }
        : false;
    });

    report.finalState = await captureSnapshot();
    report.timings = {
      aToB: {
        localManifestMs: getStageCompletion('photo-local-manifest-a'),
        remoteObjectLagMs: getStageLag('photo-local-manifest-a', 'photo-object-a-to-b'),
        remoteProjectionLagMs: getStageLag('photo-local-manifest-a', 'photo-gallery-a-to-b'),
        remoteDomLagMs: getStageLag('photo-local-manifest-a', 'photo-dom-a-to-b'),
      },
      bToA: {
        localManifestMs: getStageCompletion('photo-local-manifest-b'),
        remoteObjectLagMs: getStageLag('photo-local-manifest-b', 'photo-object-b-to-a'),
        remoteProjectionLagMs: getStageLag('photo-local-manifest-b', 'photo-gallery-b-to-a'),
        remoteDomLagMs: getStageLag('photo-local-manifest-b', 'photo-dom-b-to-a'),
      },
    };
    await writeReportArtifact(artifactDir, report);
    console.log(`[fotos-live] report written to ${join(artifactDir, 'report.json')}`);
  } catch (error) {
    report.error = getErrorMessage(error);
    report.finalState = await captureSnapshot().catch(() => null);
    await collectFailureArtifacts(pages, artifactDir, report);
    throw error;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    await browser.close().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
