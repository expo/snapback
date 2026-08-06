const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
config.resolver.assetExts.push('wasm');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'node_modules/react/index.js') };
  }
  if (moduleName === '@relay/generated-api') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'snapback/generated/api.mjs') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
