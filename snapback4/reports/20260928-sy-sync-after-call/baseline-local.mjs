// Test-only negative control: the merged baseline's local client, in memory.
import { registerHooks, createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../../packages/snapback4/package.json', import.meta.url));
const ts = require('typescript');
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/packages/snapback4/dist/local.js')) return result;
  const source = execFileSync('git', ['show', 'ede1f11773671436a1e9ce9ec09416500cd7e946:snapback4/packages/snapback4/src/local.ts'], { encoding: 'utf8' });
  return { ...result, source: ts.transpileModule(source, { fileName: 'local.ts', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true,
  } }).outputText };
} });
