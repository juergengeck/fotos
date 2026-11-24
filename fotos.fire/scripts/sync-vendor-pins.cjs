const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobileRoot = path.resolve(root, '../fotos.expo');
const manifestPath = path.join(root, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const mobile = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
const {packages} = JSON.parse(fs.readFileSync(path.join(mobileRoot, '.vendorrc.json'), 'utf8'));
const internal = name => /^@(refinio|glueone|vger)\//.test(name);
const pins = Object.entries(mobile.pnpm.overrides).filter(([name]) => internal(name));

function siblingPin(spec) {
  if (!spec.startsWith('file:./vendor/')) throw new Error(`Expected a Fotos vendor archive: ${spec}`);
  if (!fs.existsSync(path.resolve(mobileRoot, spec.slice(5)))) throw new Error(`Missing archive: ${spec}`);
  return spec.replace('file:./vendor/', 'file:../fotos.expo/vendor/');
}

const overrides = Object.fromEntries(pins.map(([name, spec]) => [name, siblingPin(spec)]));
for (const section of ['dependencies', 'devDependencies']) {
  manifest[section] = Object.fromEntries(Object.entries(manifest[section] || {}).filter(([name]) => !internal(name)));
}
for (const {name} of packages) {
  const spec = mobile.dependencies[name];
  const pin = siblingPin(spec);
  if (overrides[name] !== pin) throw new Error(`Archive override differs for ${name}`);
  manifest.dependencies[name] = pin;
}
manifest.overrides = overrides;
manifest.pnpm = {...manifest.pnpm, overrides};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Pinned the TV app to the current ${pins.length}-package Fotos vendor graph.`);
