import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {packWasmFiles} from './konrad-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, 'browser-ui');
const target = resolve(here, '_deploy-konrad');
const require = createRequire(join(ui, 'package.json'));
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const build = spawnSync(process.execPath, [vite, 'build'], {
    cwd: ui, env: {...process.env, VITE_BASE: '/konrad/'}, stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

// Only replace this deployment's generated directory.
if (dirname(target) !== here || target !== join(here, '_deploy-konrad')) throw new Error('Unexpected deployment directory');
await rm(target, {recursive: true, force: true});
const app = join(target, 'konrad');
await mkdir(app, {recursive: true});
await cp(join(ui, 'dist'), app, {recursive: true});
await rm(join(app, '_worker.js'), {force: true});
const headers = await readFile(join(app, '_headers'), 'utf8');
await rm(join(app, '_headers'));
await writeFile(join(target, '_headers'), headers.replace(/^\//gm, '/konrad/'));

await packWasmFiles(app);
console.log(`Konrad deployment prepared at ${target}`);
