// Custom Babel plugin to replace Node.js-only dynamic imports with Promise.reject()
// This prevents Metro from failing on dynamic imports that are wrapped in try-catch
module.exports = function() {
  return {
    visitor: {
      CallExpression(path) {
        // Match import() calls
        if (path.node.callee.type === 'Import') {
          const arg = path.node.arguments[0];

          // Check if it's a variable (not a string literal)
          if (arg && arg.type === 'Identifier') {
            // Replace with Promise.reject() - will be caught by try-catch at runtime
            path.replaceWithSourceString(
              'Promise.reject(new Error("Dynamic import not supported on React Native"))'
            );
          }
        }
      }
    }
  };
};
