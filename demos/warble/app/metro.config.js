const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..', '..', '..');
const config = getDefaultConfig(projectRoot);

// The Snapback packages and the generated API live outside the app directory,
// so Metro has to watch the repo root and resolve from both module trees.
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repositoryRoot, 'node_modules'),
];

const sourceAliases = new Map([
  ['react', path.resolve(projectRoot, 'node_modules/react/index.js')],
  ['@expo/snapback-client', path.resolve(repositoryRoot, 'packages/snapback-client/index.mjs')],
  ['@expo/snapback-react', path.resolve(repositoryRoot, 'packages/snapback-react/index.mjs')],
  ['@warble/generated-api', path.resolve(repositoryRoot, 'demos/warble/snapback/generated/api.mjs')],
]);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sourceFile = sourceAliases.get(moduleName);
  if (sourceFile) return { type: 'sourceFile', filePath: sourceFile };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
