import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import sharp from 'sharp';
import {ONE_LOGO_ICON_RATIO, renderedOneLogoBounds} from '@refinio/ui.theme/icons/one-centered-icon.mjs';
import {pwaIcons, renderPwaIcon} from './generate-pwa-icons.mjs';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));

test('ships the red camera scaled by its ONE logo on opaque white PWA icons', async () => {
  const svg = fs.readFileSync(path.join(packageDirectory, 'public/cam.svg'));
  for (const {name, size} of pwaIcons) {
    const actual = fs.readFileSync(path.join(packageDirectory, 'public', name));
    const metadata = await sharp(actual).metadata();
    assert.equal(metadata.format, 'png', name);
    assert.equal(metadata.width, size, name);
    assert.equal(metadata.height, size, name);
    assert.equal(metadata.hasAlpha, false, name);
    const pixels = await sharp(actual).raw().toBuffer();
    let red = 0;
    let white = 0;
    for (let index = 0; index < pixels.length; index += 3) {
      if (pixels[index] === 220 && pixels[index + 1] === 38 && pixels[index + 2] === 38) red++;
      if (pixels[index] === 255 && pixels[index + 1] === 255 && pixels[index + 2] === 255) white++;
    }
    assert.ok(red > size * size / 4, `${name} must contain the red camera`);
    assert.ok(white > size * size / 4, `${name} must sit on white`);
    assert.deepEqual(pixels, await sharp(await renderPwaIcon(svg, size)).raw().toBuffer(), `${name} is stale`);
    const logo = await renderedOneLogoBounds(sharp, svg, {size});
    assert.ok(Math.abs(logo.left + logo.width / 2 - size / 2) <= 1, `${name} must centre the ONE logo horizontally`);
    assert.ok(Math.abs(logo.top + logo.height / 2 - size / 2) <= 1, `${name} must centre the ONE logo vertically`);
    assert.ok(Math.abs(Math.max(logo.width, logo.height) - ONE_LOGO_ICON_RATIO * size) <= 2,
      `${name} must size the ONE logo to ${ONE_LOGO_ICON_RATIO} of the icon`);
  }
});

test('the manifest offers the generated icons for any and maskable use', () => {
  const config = fs.readFileSync(path.join(packageDirectory, 'vite.config.ts'), 'utf8');
  for (const size of [192, 512]) {
    for (const purpose of ['any', 'maskable']) {
      assert.match(config, new RegExp(`src: '/app/icon-${size}\\.png', sizes: '${size}x${size}', type: 'image/png', purpose: '${purpose}'`));
    }
  }
});
