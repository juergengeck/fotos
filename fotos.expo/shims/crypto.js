// Crypto shim for React Native
// react-native-get-random-values polyfills crypto.getRandomValues() globally
// This shim handles require('crypto') calls from Node.js fallback code

// Re-export the global crypto object (polyfilled by react-native-get-random-values)
module.exports = typeof crypto !== 'undefined' ? crypto : {
  getRandomValues: (arr) => {
    throw new Error('crypto.getRandomValues() not available - ensure react-native-get-random-values is imported');
  }
};
