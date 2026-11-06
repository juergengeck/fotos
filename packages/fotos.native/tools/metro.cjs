const path = require('path');
const {getDefaultConfig} = require('expo/metro-config');
const {withNativeWind} = require('nativewind/metro');

module.exports = function createFotosMetroConfig(projectRoot) {
  return withNativeWind(getDefaultConfig(projectRoot), {input: path.join(projectRoot, 'global.css')});
};
