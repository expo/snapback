const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
// Store, WAL, assets and generated runtime files are not Metro inputs.
config.resolver.blockList = [].concat(config.resolver.blockList ?? [], /(?:^|[/\\])\.snapback4(?:[/\\]|$)/);
if (!config.resolver.assetExts.includes("wasm")) config.resolver.assetExts.push("wasm");
config.transformer.babelTransformerPath = require.resolve("./metro-wasm-transformer.cjs");
module.exports = config;
