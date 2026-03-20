// fotos.core/src/ingest/index.ts
// Platform-agnostic exports only — browser-safe
export * from './types.js';
export * from './exif.js';
export * from './index-html.js';

// Node.js-only modules (hash.ts uses node:crypto, platform-node.ts uses fs/sharp, pipeline.ts uses both)
// Import directly: import { ... } from '@refinio/fotos.core/src/ingest/hash.js'
// NOT re-exported here to keep the barrel browser-safe
