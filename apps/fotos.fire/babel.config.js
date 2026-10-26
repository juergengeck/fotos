module.exports = function(api) {
  api.cache(true);
  return { presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'], plugins: ['../fotos.expo/metro-babel-plugin.js', 'react-native-reanimated/plugin'] };
};
