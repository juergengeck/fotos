// fotos.core/src/ingest/index.ts
// Platform-agnostic exports only — browser-safe
export * from './types.js';
export * from './exif.js';
export * from './index-html.js';

// Node.js-only platform-node.ts and pipeline.ts stay out of this browser-safe barrel.
// Filesystem entries use the portable hash helper internally.
