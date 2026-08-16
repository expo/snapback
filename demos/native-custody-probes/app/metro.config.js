const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..', '..', '..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repositoryRoot, 'node_modules'),
];
const sourceAliases = new Map([
  ['react', path.resolve(projectRoot, 'node_modules/react/index.js')],
  ['@probe/generated-app', path.resolve(repositoryRoot, 'demos/native-custody-probes/snapback/generated/app.mjs')],
  ['@probe/generated-api', path.resolve(repositoryRoot, 'demos/native-custody-probes/snapback/generated/api.mjs')],
]);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sourceFile = sourceAliases.get(moduleName);
  if (sourceFile) return { type: 'sourceFile', filePath: sourceFile };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
