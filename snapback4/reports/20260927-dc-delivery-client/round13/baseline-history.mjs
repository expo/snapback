import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../packages/snapback4/package.json', import.meta.url));
const ts = require('typescript');
const modules = new Set(['app-client', 'client', 'local', 'local-publication', 'read-approval']);
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  const name = url.match(/\/packages\/snapback4\/dist\/([^/]+)\.js$/)?.[1];
  if (!modules.has(name)) return result;
  const source = execFileSync('git', ['show', `6db10b223:snapback4/packages/snapback4/src/${name}.ts`], { encoding: 'utf8' });
  return { ...result, source: ts.transpileModule(source, { fileName: `${name}.ts`, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true,
  } }).outputText };
} });
