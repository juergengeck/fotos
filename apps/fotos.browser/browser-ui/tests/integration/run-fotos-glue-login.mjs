#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createSocket} from 'node:dgram';
import {createWriteStream, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {resolveHeadlessBookEnv} from './fotos-headless-book-env.mjs';
import {provisionLocalHeadlessAuthority} from './fotos-local-headless-authority.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const workspace = resolve(appRoot, '../../..');
const headlessRoot = resolve(workspace, 'sources/vger/packages/vger.headless');
const directory = mkdtempSync(join(tmpdir(), 'fotos-glue-e2e-'));
const log = createWriteStream(join(directory, 'services.log'));
const children = [];
const tcp = () => new Promise(resolvePort => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {const {port} = server.address(); server.close(() => resolvePort(port));});
});
const udp = () => new Promise(resolvePort => {
  const socket = createSocket('udp4');
  socket.bind(0, '127.0.0.1', () => {const {port} = socket.address(); socket.close(() => resolvePort(port));});
});
function start(command, args, cwd, environment = {}) {
  const child = spawn(command, args, {cwd, env: {...process.env, ...environment}, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.pipe(log, {end: false}); child.stderr.pipe(log, {end: false});
  children.push(child);
  return child;
}
async function waitFor(child, url, accept) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Service exited: ${url}; see ${directory}/services.log`);
    try {const response = await fetch(url); if (response.ok && await accept(response)) return;} catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error(`Service readiness deadline: ${url}; see ${directory}/services.log`);
}
async function stop() {
  await Promise.all(children.map(child => new Promise(done => {
    if (child.exitCode !== null) return done();
    const signal = value => {try {if (process.platform === 'win32') child.kill(value); else process.kill(-child.pid, value);} catch {}};
    child.once('exit', done); signal('SIGTERM');
    const timer = setTimeout(() => {signal('SIGKILL'); done();}, 5_000);
    timer.unref();
  })));
  log.end();
}
process.once('SIGINT', () => {void stop();});
process.once('SIGTERM', () => {void stop();});
try {
  const commPort = await tcp(), apiPort = await tcp(), browserPort = await tcp(), quicPort = await udp();
  const token = randomUUID();
  const base = `http://127.0.0.1:${apiPort}`;
  const appUrl = `http://localhost:${browserPort}/`;
  start(process.execPath, [resolve(workspace, 'sources/one/packages/one.models/comm_server.bundle.js'),
    '-h', 'localhost', '-p', String(commPort), '-l'], workspace);
  const api = start('pnpm', ['exec', 'tsx', 'src/cli.ts', '--port', String(apiPort),
    '--quicvc-port', String(quicPort), '--host', '127.0.0.1', '--storage', join(directory, 'store'),
    '--comm-server', `ws://localhost:${commPort}`, '--email', 'fotos-glue-e2e@test.local',
    '--password', 'disposable-fotos-glue-e2e-only', '--name', 'FotosGlueE2E', '--ephemeral'], headlessRoot, {
    ...resolveHeadlessBookEnv(headlessRoot), GLUE_DEBUG_REGISTRATION_TOKEN: token,
    WEBAUTHN_RP_ID: 'glue.one', WEBAUTHN_ORIGIN: 'https://glue.one', NODE_NO_WARNINGS: '1',
    // The real consent origin is distinct from the API host. Keep the normal
    // cookie/CSRF boundary and explicitly allow only this QA relying origin.
    VGER_ALLOWED_ORIGINS: 'https://glue.one',
  });
  await waitFor(api, base + '/health', async response => {
    const health = await response.json();
    return health.ready && health.auth?.postLoginReady && health.auth?.ownerSessionReady;
  });
  await provisionLocalHeadlessAuthority(base, 'fotos-glue-e2e@test.local', 'disposable-fotos-glue-e2e-only');
  console.log('[fotos-glue-e2e] Disposable registrar ready');
  const app = start(process.execPath, ['scripts/serve-qa.mjs', String(browserPort)], appRoot, {BROWSER: 'none',
    VITE_HEADLESS_URL: base, VITE_API_URL: base, VITE_COMM_SERVER_URL: `ws://localhost:${commPort}`});
  await waitFor(app, appUrl, async () => true);
  const stateFile = join(directory, 'state.json');
  writeFileSync(stateFile, JSON.stringify({base, token, dir: directory}), {mode: 0o600});
  console.log('[fotos-glue-e2e] Fotos ready; running actual browser authentication');
  for (const mode of ['popup', 'redirect']) {
    console.log(`[fotos-glue-e2e] ${mode} transport`);
    const run = spawn(process.execPath, [join(here, 'fotos-glue-login-e2e.mjs')], {cwd: appRoot, stdio: 'inherit',
      env: {...process.env, FOTOS_GLUE_QA_STATE: stateFile, FOTOS_GLUE_QA_URL: appUrl, FOTOS_GLUE_QA_MODE: mode}});
    const code = await new Promise(done => run.once('exit', value => done(value ?? 1)));
    if (code) {process.exitCode = code; break;}
  }
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await stop();
  console.log(`[fotos-glue-e2e] Evidence retained at ${directory}`);
}
