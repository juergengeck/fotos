import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

// Use the declared local dependency. Installation belongs to the ONE workspace;
// running tests must not search sibling installs or rewrite node_modules links.
const result = spawnSync(process.execPath, [require.resolve('vitest/vitest.mjs'), ...process.argv.slice(2)], {
    cwd: packageRoot,
    stdio: 'inherit',
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
