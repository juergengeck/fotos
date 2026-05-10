// Polyfills required for @fugood/transformers in React Native
// Must be imported BEFORE any transformers code

// Text encoding (required for tokenizers in older runtimes)
if (typeof globalThis.TextEncoder === 'undefined' || typeof globalThis.TextDecoder === 'undefined') {
  require('text-encoding-polyfill');
}

// Node.js built-ins
if (
  typeof globalThis.crypto === 'undefined' ||
  typeof globalThis.crypto.getRandomValues !== 'function'
) {
  require('react-native-get-random-values');
}

// XRegExp for Unicode regex support
import XRegExp from 'xregexp';

// Assert polyfill
import assert from 'assert';

function safeAssign(target, key, value) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) {
      target[key] = value;
      return;
    }

    if (descriptor.writable) {
      target[key] = value;
      return;
    }

    if (descriptor.configurable) {
      Object.defineProperty(target, key, {
        value,
        writable: true,
        configurable: true,
      });
      return;
    }

    if (descriptor.get && !descriptor.set) {
      return;
    }
  } catch (e) {
    console.warn(`[transformers-polyfills] Failed to assign ${String(key)}:`, e?.message);
  }
}

safeAssign(globalThis, 'XRegExp', XRegExp);
safeAssign(globalThis, 'assert', assert);

// Buffer polyfill (already available via react-native)
if (typeof globalThis.Buffer === 'undefined') {
  safeAssign(globalThis, 'Buffer', require('buffer').Buffer);
}

// Process polyfill - transformers env.js calls process.cwd()
// In React Native, process exists but cwd() is undefined
// We need to provide a valid path for transformers cache resolution
import * as FileSystem from 'expo-file-system';
if (typeof process !== 'undefined') {
  if (!process.cwd) {
    // Use document directory as working directory
    const docDir = FileSystem.documentDirectory || '/';
    safeAssign(process, 'cwd', () => docDir.replace('file://', ''));
  }
}

// expo-file-system paths polyfill for native-universal-fs
// native-universal-fs expects expo-file-system to have documentDirectory, cacheDirectory
// but these may not be available at module load time on some devices/configs
// We ensure they're set before transformers loads
try {
  const expoFs = require('expo-file-system');
  // If documentDirectory is undefined, native-universal-fs will fail
  // This is a workaround for the race condition
  if (expoFs && !expoFs.documentDirectory) {
    console.warn('[transformers-polyfills] expo-file-system.documentDirectory not yet available');
  }
} catch (e) {
  console.warn('[transformers-polyfills] Could not load expo-file-system:', e.message);
}

console.log('[transformers-polyfills] Polyfills initialized');
