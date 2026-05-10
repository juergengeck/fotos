const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const vgerRoot = path.resolve(workspaceRoot, 'vger');
const oneRoot = path.resolve(workspaceRoot, 'one');
const fotosRoot = path.resolve(projectRoot, '..');

config.watchFolders = [vgerRoot, oneRoot, fotosRoot];

// Use the vger.expo Babel config for all transformed files (including workspace packages).
// Required so NativeWind transforms are applied to shared RN components from vger.ui.
config.transformer.enableBabelRCLookup = false;

// Tell Metro where to find node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(vgerRoot, 'packages/vger.expo/node_modules'),
  path.resolve(vgerRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Expo 54 handles monorepo resolution automatically.
// We only need the crypto shim for react-native.
// Platform initialization is handled by importing @refinio/one.core-expo/load-expo

// Paths to canonical modules (must be single instance)
const canonicalModules = {
  'react': path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
  'react/jsx-runtime': path.resolve(projectRoot, 'node_modules/react/jsx-runtime'),
  'react/jsx-dev-runtime': path.resolve(projectRoot, 'node_modules/react/jsx-dev-runtime'),
  // Must be singleton across the whole bundle to avoid duplicate native view registration.
  'react-native-safe-area-context': path.resolve(projectRoot, 'node_modules/react-native-safe-area-context'),
  'react-native-svg': path.resolve(projectRoot, 'node_modules/react-native-svg'),
  // Must be singleton so one.core-expo's PRNG registration patches the same NaCl instance used by ONE.
  'tweetnacl': path.resolve(projectRoot, 'node_modules/tweetnacl'),
};
const reactNativeSvgEntry = path.resolve(projectRoot, 'node_modules/react-native-svg/src/index.ts');

// Node.js-only modules that should be stubbed for React Native
// These use APIs (fs, dgram, import.meta) unavailable in Hermes
const NODE_ONLY_MODULES = [
  'node:fs',
  'node:path',
  'node:crypto',
  'fs',
  'path',
  '@huggingface/transformers',
  'multicast-dns',
  '@whiskeysockets/baileys',
];
const nodeOnlyStub = path.resolve(projectRoot, 'stubs/node-only-stub.js');
const WORKSPACE_PREFIX_ALIASES = {
  '@vger/vger.core/': path.resolve(vgerRoot, 'packages/vger.core/src/'),
  '@vger/vger.ui/': path.resolve(vgerRoot, 'packages/vger.ui/src/'),
  '@refinio/coding.core/': path.resolve(vgerRoot, 'packages/coding.core/src/'),
  '@refinio/fotos.core/': path.resolve(fotosRoot, 'fotos.core/src/'),
  '@refinio/fotos.ui/': path.resolve(fotosRoot, 'fotos.ui/src/'),
  '@refinio/fotos.gallery/': path.resolve(fotosRoot, 'fotos.gallery/src/'),
  '@refinio/source.openlegal/': path.resolve(vgerRoot, 'packages/source.openlegal/src/'),
  '@refinio/source.wikipedia/': path.resolve(vgerRoot, 'packages/source.wikipedia/src/'),
  '@refinio/trust.pdf/': path.resolve(oneRoot, 'packages/trust.pdf/dist/'),
};
const WORKSPACE_EXACT_ALIASES = {
  '@vger/vger.core': path.resolve(vgerRoot, 'packages/vger.core/src/index.ts'),
  '@vger/vger.ui': path.resolve(vgerRoot, 'packages/vger.ui'),
  '@refinio/coding.core': path.resolve(vgerRoot, 'packages/coding.core/src/index.ts'),
  '@refinio/fotos.core': path.resolve(fotosRoot, 'fotos.core/src/index.ts'),
  '@refinio/fotos.ui': path.resolve(fotosRoot, 'fotos.ui/src/index.ts'),
  '@refinio/fotos.gallery': path.resolve(fotosRoot, 'fotos.gallery/src/index.ts'),
  '@refinio/source.openlegal': path.resolve(vgerRoot, 'packages/source.openlegal/src/index.ts'),
  '@refinio/source.wikipedia': path.resolve(vgerRoot, 'packages/source.wikipedia/src/index.ts'),
  '@refinio/trust.pdf': path.resolve(oneRoot, 'packages/trust.pdf/dist/index.js'),
};
const VENDORED_EXACT_ALIASES = {
  '@refinio/one.core-expo/load-expo': path.resolve(projectRoot, 'node_modules/@refinio/one.core-expo/dist/load-expo.js'),
  '@refinio/chat.core/types/ChatAttachmentSharing.js': path.resolve(
    vgerRoot,
    'packages/chat.core/src/types/ChatAttachmentSharing.ts'
  ),
  '@refinio/cube.core/dimensions/DimensionStateError.js': path.resolve(
    vgerRoot,
    'packages/cube.core/src/dimensions/DimensionStateError.ts'
  ),
  '@refinio/vger.agent/services/AgentOrchestrationRecorderService.js': path.resolve(
    vgerRoot,
    'packages/vger.agent/src/services/AgentOrchestrationRecorderService.ts'
  ),
};
const VENDORED_SINGLETON_SCOPES = [
  '@refinio/',
  '@glueone/',
];

function shouldResolveFromExpoVendor(moduleName) {
  return VENDORED_SINGLETON_SCOPES.some(scope => moduleName.startsWith(scope));
}

function resolveFromExpoVendor(context, moduleName, platform) {
  return context.resolveRequest(
    {
      ...context,
      originModulePath: path.join(projectRoot, 'package.json'),
    },
    moduleName,
    platform
  );
}

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: path.resolve(projectRoot, 'shims/crypto.js'),
  '@vger/vger.ui': path.resolve(vgerRoot, 'packages/vger.ui'),
  '@vger/vger.core': path.resolve(vgerRoot, 'packages/vger.core/src'),
  '@glueone/glue.core': path.resolve(vgerRoot, 'packages/glue.core'),
  '@refinio/one.core-expo': path.resolve(vgerRoot, 'packages/one.core-expo'),
  '@refinio/one.core-expo/load-expo': path.resolve(vgerRoot, 'packages/one.core-expo/src/load-expo.ts'),
  '@refinio/meaning.core': path.resolve(vgerRoot, 'packages/meaning.core'),
  '@refinio/fotos.core': path.resolve(fotosRoot, 'fotos.core/src'),
  '@refinio/fotos.ui': path.resolve(fotosRoot, 'fotos.ui/src'),
  '@refinio/fotos.gallery': path.resolve(fotosRoot, 'fotos.gallery/src'),
  '@shopify/flash-list': path.resolve(projectRoot, 'node_modules/@shopify/flash-list'),
  'scrypt-js': path.resolve(vgerRoot, 'packages/one.core-expo/node_modules/scrypt-js'),
  ...canonicalModules,
};

// Force all React imports to resolve to the same instance
// This prevents multiple React instances in monorepo setups
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Always resolve React/React Native from a single root instance.
  // Mixed instances can break native view registration (e.g. ActivityIndicator).
  if (
    moduleName === 'react' ||
    moduleName.startsWith('react/') ||
    moduleName === 'react-native' ||
    moduleName.startsWith('react-native/') ||
    moduleName === 'react-dom' ||
    moduleName.startsWith('react-dom/') ||
    moduleName === 'react-native-safe-area-context' ||
    moduleName.startsWith('react-native-safe-area-context/') ||
    moduleName === 'react-native-svg' ||
    moduleName.startsWith('react-native-svg/') ||
    moduleName === 'tweetnacl'
  ) {
    // react-native-svg has separate CJS/module/source entries. Mixing them in
    // one bundle registers native views such as RNSVGCircle twice.
    if (moduleName === 'react-native-svg') {
      return context.resolveRequest(context, reactNativeSvgEntry, platform);
    }

    const originModulePath =
      moduleName === 'tweetnacl' ||
      moduleName.startsWith('react-native-safe-area-context') ||
      moduleName.startsWith('react-native-svg')
        ? path.join(projectRoot, 'package.json')
        : path.join(projectRoot, 'package.json');

    return context.resolveRequest(
      {
        ...context,
        originModulePath,
      },
      moduleName,
      platform
    );
  }

  if (VENDORED_EXACT_ALIASES[moduleName]) {
    return context.resolveRequest(context, VENDORED_EXACT_ALIASES[moduleName], platform);
  }

  if (WORKSPACE_EXACT_ALIASES[moduleName]) {
    return context.resolveRequest(context, WORKSPACE_EXACT_ALIASES[moduleName], platform);
  }

  for (const [prefix, baseDir] of Object.entries(WORKSPACE_PREFIX_ALIASES)) {
    if (moduleName.startsWith(prefix)) {
      const subpath = moduleName.slice(prefix.length);
      const workspaceTarget = path.join(baseDir, subpath);
      const candidates = [];

      // Workspace sources are TS, but many package imports use ".js" subpaths.
      if (workspaceTarget.endsWith('.js')) {
        const noExt = workspaceTarget.slice(0, -3);
        if (platform) {
          candidates.push(`${noExt}.${platform}.ts`, `${noExt}.${platform}.tsx`);
        }
        candidates.push(
          `${noExt}.native.ts`,
          `${noExt}.native.tsx`,
          `${noExt}.ts`,
          `${noExt}.tsx`,
          noExt,
          workspaceTarget
        );
      } else if (!path.extname(workspaceTarget)) {
        // Also support extensionless imports (e.g. "@pkg/foo/bar")
        // by checking TS/TSX source files directly in workspace packages.
        if (platform) {
          candidates.push(`${workspaceTarget}.${platform}.ts`, `${workspaceTarget}.${platform}.tsx`);
        }
        candidates.push(
          `${workspaceTarget}.native.ts`,
          `${workspaceTarget}.native.tsx`,
          `${workspaceTarget}.ts`,
          `${workspaceTarget}.tsx`,
          workspaceTarget
        );
      } else {
        candidates.push(workspaceTarget);
      }

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return context.resolveRequest(context, candidate, platform);
        }
      }

      // Fall back so Metro can still try extension resolution.
      return context.resolveRequest(context, candidates[0], platform);
    }
  }

  // Mobile uses rebuilt vendor tarballs for the refinio/glue dependency graph.
  // Workspace source imports must still resolve these packages from the Expo
  // install, otherwise singleton registries such as @refinio/api split in two.
  if (shouldResolveFromExpoVendor(moduleName)) {
    return resolveFromExpoVendor(context, moduleName, platform);
  }

  // Stub out Node.js-only modules that can't run in React Native
  if (NODE_ONLY_MODULES.some(pkg => moduleName === pkg || moduleName.startsWith(pkg + '/'))) {
    return {
      type: 'sourceFile',
      filePath: nodeOnlyStub,
    };
  }

  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    (
      context.originModulePath.includes('/packages/') ||
      context.originModulePath.startsWith(fotosRoot)
    )
  ) {
    const absoluteTarget = path.resolve(path.dirname(context.originModulePath), moduleName);
    const noExt = absoluteTarget.slice(0, -3);
    const platformCandidates = platform
      ? [`${noExt}.${platform}.ts`, `${noExt}.${platform}.tsx`]
      : [];
    const localCandidates = [
      ...platformCandidates,
      `${noExt}.native.ts`,
      `${noExt}.native.tsx`,
      `${noExt}.ts`,
      `${noExt}.tsx`,
      noExt,
    ];

    // Prefer TS/TSX siblings over stale checked-in JS within workspace packages.
    // Many source files import "*.js" for ESM compatibility, but Metro in this
    // monorepo should execute the latest TypeScript sources when available.
    // Keep platform-specific variants first so native builds do not accidentally
    // mount browser components such as ChatLayout.tsx instead of ChatLayout.native.tsx.
    for (const candidate of localCandidates) {
      if (fs.existsSync(candidate)) {
        return context.resolveRequest(context, candidate, platform);
      }
    }

    if (fs.existsSync(absoluteTarget)) {
      return context.resolveRequest(context, absoluteTarget, platform);
    }
  }

  // Use default resolver for everything else
  return context.resolveRequest(context, moduleName, platform);
};

// NativeWind requires this wrapper
module.exports = withNativeWind(config, { input: './global.css' });
