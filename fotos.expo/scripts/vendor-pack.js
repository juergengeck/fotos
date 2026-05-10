#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor');
const VENDOR_RC = path.join(PROJECT_ROOT, '.vendorrc.json');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');

console.log('📦 Vendoring monorepo packages...\n');

// Read configuration
const config = JSON.parse(fs.readFileSync(VENDOR_RC, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

// Create vendor directory
if (!fs.existsSync(VENDOR_DIR)) {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  console.log(`✓ Created ${VENDOR_DIR}`);
}

// Track all packed tarballs
const packedTarballs = new Map();

// PHASE 1: Pack all packages
console.log('Phase 1: Packing all packages...\n');
for (const pkg of config.packages) {
  const pkgPath = path.resolve(PROJECT_ROOT, pkg.path);

  console.log(`Packing ${pkg.name} from ${pkg.path}...`);

  if (!fs.existsSync(pkgPath)) {
    console.error(`✗ Package path does not exist: ${pkgPath}`);
    process.exit(1);
  }

  try {
    // Run pnpm pack (resolves catalog: references)
    const output = execSync(
      `pnpm pack --pack-destination="${VENDOR_DIR}"`,
      { cwd: pkgPath, encoding: 'utf8' }
    );

    // Extract tarball filename from output (last line)
    // pnpm pack returns full path, npm pack returns just filename
    const lines = output.trim().split('\n');
    const tarballPath = lines[lines.length - 1].trim();

    if (!tarballPath.endsWith('.tgz')) {
      console.error(`✗ Unexpected pack output: ${tarballPath}`);
      process.exit(1);
    }

    // Extract just the filename from the path
    const tarballName = path.basename(tarballPath);
    packedTarballs.set(pkg.name, tarballName);
    console.log(`  ✓ Created vendor/${tarballName}`);

  } catch (error) {
    console.error(`✗ Failed to pack ${pkg.name}:`);
    console.error(error.message);
    process.exit(1);
  }
}

// PHASE 2: SKIPPED - Dependencies already use '*' which npm will resolve from vendor tarballs
console.log(`\nPhase 2: Skipped (source packages use '*' for inter-package deps)\n`);

// PHASE 3: Update package.json dependencies
console.log(`\nPhase 3: Updating package.json dependencies...\n`);

let updated = 0;
const overrides = {};
for (const [pkgName, tarballName] of packedTarballs) {
  overrides[pkgName] = `file:./vendor/${tarballName}`;

  if (packageJson.dependencies && packageJson.dependencies[pkgName]) {
    const oldValue = packageJson.dependencies[pkgName];
    const newValue = `file:./vendor/${tarballName}`;

    if (oldValue !== newValue) {
      packageJson.dependencies[pkgName] = newValue;
      console.log(`  ${pkgName}: ${oldValue} → ${newValue}`);
      updated++;
    }
  }
}

const existingOverrides = JSON.stringify(packageJson.overrides ?? {});
const nextOverrides = JSON.stringify(overrides);
if (existingOverrides !== nextOverrides) {
  packageJson.overrides = overrides;
  updated++;
}

const existingPnpmOverrides = JSON.stringify(packageJson.pnpm?.overrides ?? {});
if (existingPnpmOverrides !== nextOverrides) {
  packageJson.pnpm = {
    ...(packageJson.pnpm ?? {}),
    overrides,
  };
  updated++;
}

if (updated > 0) {
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`\n✓ Updated ${updated} dependencies in package.json`);
} else {
  console.log(`\n✓ All dependencies already up-to-date`);
}

console.log(`\n✅ Vendoring complete!`);
console.log(`\nNext steps:`);
console.log(`  1. Run: pnpm install --ignore-workspace`);
console.log(`     Avoid npm here: it climbs back into the monorepo workspace.`);
console.log(`  2. Run: pnpm run ios\n`);
