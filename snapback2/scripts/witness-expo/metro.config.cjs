// The pre-publication witness links dist from outside its generated app root.
// SDK 54's file map needs that dependency tree in watchFolders (Expo Metro docs).
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
if (process.env.SNAPBACK2_EXPO_WORKSPACE) {
  config.watchFolders = [process.env.SNAPBACK2_EXPO_WORKSPACE];
  config.resolver.nodeModulesPaths = [require('node:path').join(__dirname, 'node_modules')];
}
module.exports = config;
