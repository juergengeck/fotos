import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {renderOneCenteredIcon} from '@refinio/ui.theme/icons/one-centered-icon.mjs';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const artwork = new URL('../public/cam.svg', import.meta.url);
export const pwaIcons = [
  {name: 'apple-touch-icon.png', size: 180},
  {name: 'icon-192.png', size: 192},
  {name: 'icon-512.png', size: 512},
];
const background = '#ffffff';

/** The embedded ONE logo sets the scale; iOS and maskable launchers supply their own mask. */
export async function renderPwaIcon(svg, size) {
  return renderOneCenteredIcon(sharp, svg, {size, background});
}

export async function generatePwaIcons(outputDirectory = publicDirectory) {
  const svg = await fs.readFile(artwork);
  await fs.mkdir(outputDirectory, {recursive: true});
  for (const {name, size} of pwaIcons) {
    await fs.writeFile(path.join(outputDirectory, name), await renderPwaIcon(svg, size));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generatePwaIcons();
}
