const fs = require('node:fs');
const path = require('node:path');

if (process.argv.length > 4) throw new Error('Usage: vendor-normalize-lockfile.js [app-root] [vendor-directory]');
const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const vendorDirectory = process.argv[3] ? path.resolve(process.argv[3]) : path.join(projectRoot, 'vendor');
const relativeVendor = path.relative(projectRoot, vendorDirectory).split(path.sep).join('/');
const lockfilePath = path.join(projectRoot, 'pnpm-lock.yaml');
const original = fs.readFileSync(lockfilePath, 'utf8');
let portable = original;

// pnpm 9 resolves peer overrides to absolute paths when it serializes them.
// Keep local vendor pins usable when the checkout lives at another path.
for (const root of new Set([vendorDirectory, fs.realpathSync(vendorDirectory)])) {
  const vendorPath = root.split(path.sep).join('/');
  portable = portable.replaceAll(`file:${vendorPath}/`, `file:${relativeVendor}/`);
}

if (portable !== original) fs.writeFileSync(lockfilePath, portable);
