import {readFileSync} from 'node:fs';
import path from 'node:path';

/** Supply the public key pin for the bundle that this local headless will open. */
export function resolveHeadlessBookEnv(headlessRoot, env = process.env) {
  const bundlePath = env.VGER_BOOK_BUNDLE_PATH?.trim()
    || path.join(headlessRoot, 'assets', 'vger-book-bundle.json');
  let publicKeys = env.VGER_BOOK_BUNDLE_PUBLIC_KEYS?.trim();
  if (!publicKeys) {
    const sidecar = JSON.parse(readFileSync(`${bundlePath}.pubkeys`, 'utf8'));
    if (!Array.isArray(sidecar.publicSignKeys)) {
      throw new Error(`Book bundle sidecar has no public signing keys: ${bundlePath}.pubkeys`);
    }
    publicKeys = sidecar.publicSignKeys.join(',');
  }
  if (!publicKeys.split(',').every(key => /^[a-f0-9]{64}$/i.test(key.trim()))) {
    throw new Error('Book bundle public signing keys must be 32-byte hexadecimal values');
  }
  return {VGER_BOOK_BUNDLE_PATH: bundlePath, VGER_BOOK_BUNDLE_PUBLIC_KEYS: publicKeys};
}
