// The app lives in a bun workspace: Metro watches the workspace root and
// resolves packages from both node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules"), path.resolve(root, "node_modules")];
config.resolver.unstable_enablePackageExports = true;
module.exports = config;
