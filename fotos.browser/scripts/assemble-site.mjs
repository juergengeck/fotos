import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, '_deploy'));
if (output === root || !output.startsWith(`${root}/`)) throw new Error('Output must be a subdirectory of fotos.browser');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(root, 'browser-ui/dist'), join(output, 'app'), { recursive: true });
for (const file of ['index.html', 'cam.svg', 'sw.js']) cpSync(join(root, 'public', file), join(output, file));
cpSync(join(root, 'browser-ui/public/_worker.js'), join(output, '_worker.js'));
rmSync(join(output, 'app/_worker.js'), { force: true });
// Disable Pages' implicit root SPA fallback; the worker handles app routes.
writeFileSync(join(output, '404.html'), '<!doctype html><title>Not found</title><h1>Not found</h1>');
writeFileSync(join(output, '_headers'), '/sw.js\n  Cache-Control: no-store\n/app/sw.js\n  Cache-Control: no-cache\n');
function stripLargeWasm(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) stripLargeWasm(file);
        else if (entry.name.endsWith('.wasm') && statSync(file).size > 25 * 1024 * 1024) rmSync(file);
    }
}
stripLargeWasm(join(output, 'app/assets'));
console.log(`Assembled marketing and app in ${output}`);
