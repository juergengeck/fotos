import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const branch = spawnSync('git', ['branch', '--show-current'], {cwd: here, encoding: 'utf8'});
if (branch.status !== 0 || branch.stdout.trim() !== 'konrad') throw new Error('Deploy Konrad from the konrad branch.');
const build = spawnSync(process.execPath, [join(here, 'build-konrad.mjs')], {cwd: here, stdio: 'inherit'});
if (build.status !== 0) process.exit(build.status ?? 1);
const deploy = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'wrangler@4.151.2', 'deploy', '--config', 'wrangler.konrad.jsonc'], {
    cwd: here, stdio: 'inherit', shell: process.platform === 'win32',
});
if (deploy.error) throw deploy.error;
process.exit(deploy.status ?? 1);
