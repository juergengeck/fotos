#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_UI_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(BROWSER_UI_ROOT, '../..');
const VGER_ROOT = resolve(REPO_ROOT, 'vger');
const ONE_ROOT = resolve(REPO_ROOT, '../one');
const HEADLESS_ROOT = resolve(VGER_ROOT, 'packages/vger.headless');
const HEADLESS_CLI = 'src/cli.ts';
const COMM_SERVER_BUNDLE = resolve(ONE_ROOT, 'packages/one.models/comm_server.bundle.js');
const SUITE_SCRIPT = resolve(__dirname, 'fotos-adhoc-gallery-share-suite.mjs');
const STATIC_SERVER = resolve(__dirname, 'browser-static-server.cjs');
const VITE_BIN = resolve(BROWSER_UI_ROOT, 'node_modules/vite/bin/vite.js');
const SELLER_PAYMENTS_ROOT = resolve(VGER_ROOT, 'packages/seller.payments');
const SELLER_PAYMENTS_DIST = resolve(SELLER_PAYMENTS_ROOT, 'dist/index.js');
const START_TIMEOUT_MS = Number(process.env.FOTOS_ADHOC_SERVER_TIMEOUT_MS || 90_000);

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function prefixOutput(stream, prefix) {
  return data => {
    stream.write(`${prefix}${data.toString()}`);
  };
}

function logChildLifecycle(child, label) {
  child.once('error', error => {
    console.error(`${label}:err failed to start: ${error instanceof Error ? error.message : error}`);
  });
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') {
      return;
    }

    console.error(`${label}:err exited early with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
}

function terminateProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      child.kill(signal);
      return;
    }

    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Best-effort cleanup.
    }
  }
}

function getFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectPromise(new Error('Failed to allocate free port'));
        return;
      }

      const { port } = address;
      server.close(error => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(port);
      });
    });
    server.on('error', rejectPromise);
  });
}

function getFreeUdpPort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createSocket('udp4');
    socket.bind(0, '127.0.0.1', () => {
      const address = socket.address();
      if (typeof address === 'string') {
        socket.close();
        rejectPromise(new Error('Failed to allocate a free UDP port'));
        return;
      }

      const { port } = address;
      socket.close(() => resolvePromise(port));
    });
    socket.on('error', error => {
      socket.close();
      rejectPromise(error);
    });
  });
}

async function assertPortAvailable(port, label, host = '127.0.0.1') {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once('error', error => {
      rejectPromise(new Error(`${label} port ${host}:${port} is not available: ${error.message}`));
    });
    server.listen(port, host, () => {
      server.close(closeError => {
        if (closeError) {
          rejectPromise(closeError);
          return;
        }

        resolvePromise();
      });
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 304) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for headless health at ${baseUrl}`);
}

async function waitForPostLoginReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api`);
      if (response.ok) {
        const body = await response.json();
        const handlers = body.handlers ?? [];
        if (handlers.some(handler => handler.name === 'connection' || handler.name === 'connections')) {
          return;
        }
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for post-login handlers at ${baseUrl}`);
}

async function waitForWsPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        const socket = new WebSocket(`ws://localhost:${port}`);
        let settled = false;

        const finish = callback => {
          if (settled) {
            return;
          }
          settled = true;
          try {
            socket.close();
          } catch {
            // Best-effort cleanup.
          }
          callback();
        };

        const timer = setTimeout(() => finish(rejectPromise), 2_000);
        socket.onopen = () => {
          clearTimeout(timer);
          finish(resolvePromise);
        };
        socket.onerror = () => {
          clearTimeout(timer);
          finish(rejectPromise);
        };
      });
      return;
    } catch {
      await sleep(300);
    }
  }

  throw new Error(`Timed out waiting for commserver on port ${port}`);
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null) {
    return;
  }

  await new Promise(resolvePromise => {
    const timer = setTimeout(() => {
      terminateProcessTree(child, 'SIGKILL');
      resolvePromise();
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function runCheckedCommand(command, args, options, label) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', prefixOutput(process.stdout, `${label} `));
  child.stderr?.on('data', prefixOutput(process.stderr, `${label}:err `));

  const exitCode = await new Promise(resolvePromise => {
    child.once('exit', code => resolvePromise(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

async function ensureBuiltPrerequisites() {
  if (!existsSync(SELLER_PAYMENTS_DIST)) {
    await runCheckedCommand('/bin/bash', ['-lc', 'pnpm build'], {
      cwd: SELLER_PAYMENTS_ROOT,
      env: process.env,
    }, '[seller.payments]');
  }
}

async function buildBrowserUi(env, outDir) {
  await runCheckedCommand(
    process.execPath,
    [VITE_BIN, 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: BROWSER_UI_ROOT,
      env,
    },
    '[browser-ui build]',
  );
}

function spawnStaticServer(label, port, rootDir) {
  const child = spawn(
    process.execPath,
    [STATIC_SERVER, '--host', 'localhost', '--port', String(port), '--root', rootDir],
    {
      cwd: BROWSER_UI_ROOT,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', prefixOutput(process.stdout, `[${label}] `));
  child.stderr?.on('data', prefixOutput(process.stderr, `[${label}:err] `));
  logChildLifecycle(child, `[${label}]`);
  return child;
}

async function main() {
  const commPort = Number(process.env.FOTOS_ADHOC_COMM_PORT || await getFreePort());
  const headlessPort = Number(process.env.FOTOS_ADHOC_HEADLESS_PORT || await getFreePort());
  const headlessQuicVCPort = Number(
    process.env.FOTOS_ADHOC_HEADLESS_QUICVC_PORT || await getFreeUdpPort(),
  );
  const senderPort = Number(process.env.FOTOS_ADHOC_SENDER_PORT || await getFreePort());
  const recipientPort = Number(process.env.FOTOS_ADHOC_RECIPIENT_PORT || await getFreePort());
  const commUrl = `ws://localhost:${commPort}`;
  const headlessUrl = `http://localhost:${headlessPort}`;
  const senderUrl = `http://localhost:${senderPort}/`;
  const recipientUrl = `http://localhost:${recipientPort}/`;
  const storageDir = mkdtempSync(path.join(tmpdir(), 'fotos-adhoc-share-headless-'));
  const browserBuildDir = mkdtempSync(path.join(tmpdir(), 'fotos-adhoc-share-dist-'));
  const debugRegistrationToken = process.env.GLUE_DEBUG_REGISTRATION_TOKEN || randomUUID();
  const debugRegistrationTtlMs = process.env.GLUE_DEBUG_REGISTRATION_TTL_MS || String(30 * 60 * 1000);

  if (senderPort === recipientPort) {
    throw new Error(`Sender and recipient ports must differ; both were ${senderPort}`);
  }

  await Promise.all([
    assertPortAvailable(senderPort, 'sender browser', '127.0.0.1'),
    assertPortAvailable(senderPort, 'sender browser', 'localhost'),
    assertPortAvailable(recipientPort, 'recipient browser', '127.0.0.1'),
    assertPortAvailable(recipientPort, 'recipient browser', 'localhost'),
  ]);

  const commServer = spawn(
    process.execPath,
    [COMM_SERVER_BUNDLE, '-h', 'localhost', '-p', String(commPort), '-l'],
    {
      cwd: REPO_ROOT,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  commServer.stdout?.on('data', prefixOutput(process.stdout, '[commserver] '));
  commServer.stderr?.on('data', prefixOutput(process.stderr, '[commserver:err] '));
  logChildLifecycle(commServer, '[commserver]');

  const headless = spawn(
    'pnpm',
    [
      'exec',
      'tsx',
      HEADLESS_CLI,
      '--port', String(headlessPort),
      '--quicvc-port', String(headlessQuicVCPort),
      '--host', 'localhost',
      '--storage', storageDir,
      '--comm-server', commUrl,
      '--email', 'fotos-adhoc-share@test.local',
      '--password', 'fotos-adhoc-share-pass',
      '--name', 'FotosAdhocShare',
      '--ephemeral',
    ],
    {
      cwd: HEADLESS_ROOT,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GLUE_DEBUG_REGISTRATION_TOKEN: debugRegistrationToken,
        NODE_NO_WARNINGS: '1',
      },
    },
  );
  headless.stdout?.on('data', prefixOutput(process.stdout, '[headless] '));
  headless.stderr?.on('data', prefixOutput(process.stderr, '[headless:err] '));
  logChildLifecycle(headless, '[headless]');

  let trustedSystemKeys = process.env.VITE_TRUSTED_SYSTEM_KEYS || '';
  const browserServers = [];

  try {
    await ensureBuiltPrerequisites();

    await waitForWsPort(commPort, START_TIMEOUT_MS);
    await waitForHealth(headlessUrl, START_TIMEOUT_MS);
    await waitForPostLoginReady(headlessUrl, START_TIMEOUT_MS);

    try {
      const systemKeyResponse = await fetch(`${headlessUrl}/api/glue/systemPublicKey`);
      if (systemKeyResponse.ok) {
        const payload = await systemKeyResponse.json();
        trustedSystemKeys = payload.publicKey ?? payload.data?.publicKey ?? trustedSystemKeys;
      }
    } catch {
      // System content verification is not required for the integration flow.
    }

    const browserUiEnv = {
      ...process.env,
      BROWSER: 'none',
      VITE_HEADLESS_URL: headlessUrl,
      VITE_API_URL: headlessUrl,
      VITE_COMM_SERVER_URL: commUrl,
      VITE_GLUE_DEBUG_REGISTRATION_TOKEN: debugRegistrationToken,
      VITE_GLUE_DEBUG_REGISTRATION_TTL_MS: debugRegistrationTtlMs,
      ...(trustedSystemKeys ? { VITE_TRUSTED_SYSTEM_KEYS: trustedSystemKeys } : {}),
    };

    await buildBrowserUi(browserUiEnv, browserBuildDir);

    browserServers.push(
      spawnStaticServer('browser-static:sender', senderPort, browserBuildDir),
      spawnStaticServer('browser-static:recipient', recipientPort, browserBuildDir),
    );

    await Promise.all([
      waitForHttp(`${senderUrl}health`, START_TIMEOUT_MS),
      waitForHttp(`${recipientUrl}health`, START_TIMEOUT_MS),
      waitForHttp(senderUrl, START_TIMEOUT_MS),
      waitForHttp(recipientUrl, START_TIMEOUT_MS),
    ]);

    const suiteRun = spawn(process.execPath, [SUITE_SCRIPT], {
      cwd: BROWSER_UI_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        FOTOS_ADHOC_SHARE_URL_A: senderUrl,
        FOTOS_ADHOC_SHARE_URL_B: recipientUrl,
        FOTOS_ADHOC_API_BASE: headlessUrl,
      },
    });

    const exitCode = await new Promise(resolvePromise => {
      suiteRun.once('exit', code => resolvePromise(code ?? 1));
    });

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    for (const browserServer of browserServers) {
      terminateProcessTree(browserServer, 'SIGTERM');
    }
    terminateProcessTree(headless, 'SIGTERM');
    terminateProcessTree(commServer, 'SIGTERM');

    await Promise.all([
      ...browserServers.map(browserServer => waitForExit(browserServer).catch(() => {})),
      waitForExit(headless).catch(() => {}),
      waitForExit(commServer).catch(() => {}),
    ]);

    try {
      rmSync(storageDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }

    try {
      rmSync(browserBuildDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
