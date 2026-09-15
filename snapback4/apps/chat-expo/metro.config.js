// The app lives in a bun workspace: Metro watches the workspace root and
// resolves packages from both node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules"), path.resolve(root, "node_modules")];
config.resolver.unstable_enablePackageExports = true;
// Store, WAL, assets and generated runtime files are not Metro inputs.
config.resolver.blockList = [].concat(config.resolver.blockList ?? [], /(?:^|[/\\])\.snapback4(?:[/\\]|$)/);
module.exports = config;
