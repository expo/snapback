const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..', '..');
const config = getDefaultConfig(projectRoot);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repositoryRoot, 'node_modules'),
];
const aliases = new Map([
  ['react', path.resolve(projectRoot, 'node_modules/react/index.js')],
  ['react/jsx-runtime', path.resolve(projectRoot, 'node_modules/react/jsx-runtime.js')],
  ['react-dom', path.resolve(projectRoot, 'node_modules/react-dom/index.js')],
  ['react-dom/client', path.resolve(projectRoot, 'node_modules/react-dom/client.js')],
  ['@knockoff/snapback-react', path.resolve(repositoryRoot, 'packages/snapback-react/index.mjs')],
]);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = aliases.get(moduleName);
  if (filePath) return { type: 'sourceFile', filePath };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
