module.exports = function(api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      require.resolve('@refinio/fotos.native/babel-plugin'),
      "react-native-reanimated/plugin",
    ],
  };
};
