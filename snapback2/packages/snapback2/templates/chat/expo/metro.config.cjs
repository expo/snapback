const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// `.snapback/` is Snapback's build cache, not app source. `snapback2 check` and
// `snapback2 test` rename directories inside it, and Metro's watcher exits with
// ENOENT if it crawls one mid-rename. `.cjs` so the config loads whether or not
// the project's package.json says "type": "module".
const snapbackCache = /[\\/]\.snapback[\\/]/;
config.resolver.blockList = config.resolver.blockList
  ? [].concat(config.resolver.blockList, snapbackCache)
  : snapbackCache;

module.exports = config;
