/**
 * Shim that provides the legacy expo-file-system API for native-universal-fs.
 *
 * This re-exports the legacy API but ensures documentDirectory and cacheDirectory
 * have fallback values to prevent crashes when the native module isn't ready.
 */

console.log('[expo-file-system-legacy-shim] Loading shim...');

// Provide fallback paths - these MUST be valid strings
const fallbackDocDir = 'file:///var/mobile/Containers/Data/Application/documents/';
const fallbackCacheDir = 'file:///var/mobile/Containers/Data/Application/cache/';

let legacyFs;
let documentDirectory = fallbackDocDir;
let cacheDirectory = fallbackCacheDir;

try {
  legacyFs = require('expo-file-system/src/legacy');
  console.log('[expo-file-system-legacy-shim] Legacy API loaded');
  console.log('[expo-file-system-legacy-shim] documentDirectory:', legacyFs.documentDirectory);
  console.log('[expo-file-system-legacy-shim] cacheDirectory:', legacyFs.cacheDirectory);

  if (legacyFs.documentDirectory) {
    documentDirectory = legacyFs.documentDirectory;
  }
  if (legacyFs.cacheDirectory) {
    cacheDirectory = legacyFs.cacheDirectory;
  }
} catch (e) {
  console.error('[expo-file-system-legacy-shim] Failed to load legacy API:', e.message);
  legacyFs = {};
}

console.log('[expo-file-system-legacy-shim] Using documentDirectory:', documentDirectory);
console.log('[expo-file-system-legacy-shim] Using cacheDirectory:', cacheDirectory);

module.exports = {
  ...legacyFs,
  documentDirectory,
  cacheDirectory,
  bundleDirectory: legacyFs?.bundleDirectory || null,
};
