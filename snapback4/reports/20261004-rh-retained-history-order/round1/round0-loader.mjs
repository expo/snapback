import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
const { default: ts } = await import(pathToFileURL(root + '/snapback4/node_modules/typescript/lib/typescript.js'));
const sources = new Map();
for (const name of ['local', 'local-query', 'local-search']) {
  const source = execFileSync('git', ['show', `0094fe7fd7:snapback4/packages/snapback4/src/${name}.ts`], {cwd:root, encoding:'utf8'});
  sources.set(pathToFileURL(root + `/snapback4/packages/snapback4/dist/${name}.js`).href,
    ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,rewriteRelativeImportExtensions:true}}).outputText);
}
registerHooks({load(url, context, next) { return sources.has(url) ? {format:'module',source:sources.get(url),shortCircuit:true} : next(url, context); }});
