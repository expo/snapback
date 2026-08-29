const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web build loads its wa-sqlite engine as a .wasm asset; Metro
// only bundles it when wasm is declared an asset extension. Without this the
// web export fails to resolve wa-sqlite.wasm through the
// @expo/snapback-expo -> expo-sqlite carrier import chain.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// @ref issues/closed/20260827-snapback-expo-metro-generations-watcher-crash.md —
// Current codegen stages generation candidates outside the project tree. Keep
// this block for mixed-version projects whose older codegen may still churn
// `.snapback/generations/.tmp-*` under Metro's watcher.
const snapbackGenerations = /[\\/]\.snapback[\\/]generations[\\/]/;
config.resolver.blockList = config.resolver.blockList
  ? [].concat(config.resolver.blockList, snapbackGenerations)
  : snapbackGenerations;

module.exports = config;
