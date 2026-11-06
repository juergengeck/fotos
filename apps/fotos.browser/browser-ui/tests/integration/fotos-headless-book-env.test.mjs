import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {resolveHeadlessBookEnv} from './fotos-headless-book-env.mjs';

test('pins the packaged local book bundle from its authoring sidecar', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fotos-book-env-'));
  try {
    mkdirSync(path.join(root, 'assets'));
    const bundlePath = path.join(root, 'assets', 'vger-book-bundle.json');
    const key = 'a'.repeat(64);
    writeFileSync(`${bundlePath}.pubkeys`, JSON.stringify({publicSignKeys: [key]}));
    assert.deepEqual(resolveHeadlessBookEnv(root, {}), {
      VGER_BOOK_BUNDLE_PATH: bundlePath,
      VGER_BOOK_BUNDLE_PUBLIC_KEYS: key,
    });
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('preserves an explicit bundle path and key pin', () => {
  const bundlePath = '/release/custom-book-bundle.json';
  const key = 'b'.repeat(64);
  assert.deepEqual(resolveHeadlessBookEnv('/unused', {
    VGER_BOOK_BUNDLE_PATH: bundlePath,
    VGER_BOOK_BUNDLE_PUBLIC_KEYS: key,
  }), {VGER_BOOK_BUNDLE_PATH: bundlePath, VGER_BOOK_BUNDLE_PUBLIC_KEYS: key});
});
