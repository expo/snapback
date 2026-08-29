const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web build loads its wa-sqlite engine as a .wasm asset; Metro
// only bundles it when wasm is declared an asset extension. Without this the
// web export fails to resolve wa-sqlite.wasm through the
// @expo/snapback-expo -> expo-sqlite carrier import chain.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
