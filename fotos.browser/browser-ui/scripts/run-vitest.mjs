import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');

const candidates = [
    path.join(packageRoot, 'node_modules', '.bin', 'vitest'),
    path.join(packageRoot, '..', '..', 'fotos.core', 'node_modules', '.bin', 'vitest'),
    path.join(packageRoot, '..', '..', 'fotos.ui', 'node_modules', '.bin', 'vitest'),
];

const vitestBinary = candidates.find(candidate => existsSync(candidate));

if (!vitestBinary) {
    console.error('Unable to locate a vitest binary for fotos.browser/browser-ui.');
    process.exit(1);
}

const result = spawnSync(vitestBinary, process.argv.slice(2), {
    cwd: packageRoot,
    stdio: 'inherit',
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
