/**
 * Stub module for Node.js-only packages that shouldn't be bundled for React Native.
 * These packages use APIs (fs, dgram, import.meta) unavailable in Hermes/React Native.
 */

// Throw a helpful error if the stub is actually invoked at runtime
const createStub = (packageName) => {
  const handler = {
    get: (target, prop) => {
      if (prop === '__esModule') {
        return true;
      }
      if (prop === 'default') {
        return createStub(packageName);
      }
      if (prop === Symbol.toStringTag) {
        return 'Module';
      }
      if (prop === 'then') {
        return undefined;
      }
      if (typeof prop === 'string') {
        return createStub(`${packageName}.${prop}`);
      }
      throw new Error(
        `[iOS Stub] "${packageName}" is not available on React Native. ` +
        `This module uses Node.js APIs. Check your import path.`
      );
    },
    apply: () => {
      throw new Error(
        `[iOS Stub] "${packageName}" cannot be called on React Native.`
      );
    },
  };
  return new Proxy(function() {}, handler);
};

module.exports = createStub('node-only-module');
module.exports.default = module.exports;
module.exports.__esModule = true;
