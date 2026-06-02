import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const fotosRoot = path.resolve(packageRoot, '..', '..', '..');
const vgerRoot = path.resolve(fotosRoot, 'vger');

const candidates = [
    path.join(vgerRoot, 'node_modules', '.pnpm', 'node_modules', 'vitest', 'vitest.mjs'),
    path.join(packageRoot, 'node_modules', '.bin', 'vitest'),
    path.join(packageRoot, '..', '..', 'fotos.core', 'node_modules', '.bin', 'vitest'),
    path.join(packageRoot, '..', '..', 'fotos.ui', 'node_modules', '.bin', 'vitest'),
    path.join(vgerRoot, 'node_modules', '.bin', 'vitest'),
];

function existingPathOrBrokenSymlink(targetPath) {
    if (existsSync(targetPath)) {
        return true;
    }

    try {
        lstatSync(targetPath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

function packageDirectoryForBinary(binaryPath) {
    if (binaryPath.endsWith('.mjs')) {
        return path.dirname(binaryPath);
    }

    if (!binaryPath.includes(`${path.sep}.bin${path.sep}`)) {
        return undefined;
    }

    const nodeModulesRoot = path.dirname(path.dirname(binaryPath));
    return path.join(nodeModulesRoot, 'vitest');
}

function findVitest() {
    for (const candidate of candidates) {
        if (!existsSync(candidate)) {
            continue;
        }

        const packageDirectory = packageDirectoryForBinary(candidate);
        if (!packageDirectory || !existsSync(path.join(packageDirectory, 'package.json'))) {
            continue;
        }

        return {
            binary: candidate,
            packageDirectory: realpathSync(packageDirectory),
        };
    }

    return undefined;
}

function ensureLocalPackageLink(vitestPackageDirectory) {
    const nodeModulesDirectory = path.join(packageRoot, 'node_modules');
    const localPackageDirectory = path.join(nodeModulesDirectory, 'vitest');

    mkdirSync(nodeModulesDirectory, { recursive: true });

    let currentTarget;
    try {
        currentTarget = realpathSync(localPackageDirectory);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            currentTarget = undefined;
        }
    }

    if (currentTarget === vitestPackageDirectory) {
        return;
    }

    if (existingPathOrBrokenSymlink(localPackageDirectory)) {
        unlinkSync(localPackageDirectory);
    }

    symlinkSync(vitestPackageDirectory, localPackageDirectory, 'dir');
}

const vitest = findVitest();

if (!vitest) {
    console.error('Unable to locate a vitest binary for fotos.browser/browser-ui.');
    process.exit(1);
}

ensureLocalPackageLink(vitest.packageDirectory);

const vitestBinary = vitest.binary;
const useNode = vitestBinary.endsWith('.mjs');
const result = spawnSync(
    useNode ? process.execPath : vitestBinary,
    useNode ? [vitestBinary, ...process.argv.slice(2)] : process.argv.slice(2),
    {
        cwd: packageRoot,
        stdio: 'inherit',
    },
);

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
