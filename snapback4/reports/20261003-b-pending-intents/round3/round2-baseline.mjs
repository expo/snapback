// Replay the exact reviewed implementation without changing the working tree.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import ts from 'typescript';
const sources = new Map();
const originals = new Map(['client', 'pending-items', 'app-online', 'react-pending-items'].map(name => {
  const source = execFileSync('git', ['show', `aa5d4c15fc:snapback4/packages/snapback4/src/${name}.ts`], { encoding: 'utf8' });
  sources.set(name, source);
  return [name, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/\.ts(["'])/g, '.js$1')];
}));
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context), name = /\/snapback4\/packages\/snapback4\/dist\/(client|pending-items|app-online|react-pending-items)\.js$/.exec(url)?.[1];
  return name ? { ...result, source: originals.get(name) } : result;
} });

// Vite reads TypeScript directly for the actual React hook harness.
const guide = execFileSync('git', ['show', 'aa5d4c15fc:snapback4/packages/snapback4/CLIENT-AND-OPERATIONS.md'], { encoding: 'utf8' });
const replace = (path, body) => {
  if (String(path).endsWith('/snapback4/packages/snapback4/CLIENT-AND-OPERATIONS.md')) return typeof body === 'string' ? guide : Buffer.from(guide);
  const name = /\/snapback4\/packages\/snapback4\/src\/(client|pending-items|app-online|react-pending-items)\.ts$/.exec(String(path))?.[1];
  return name ? (typeof body === 'string' ? sources.get(name) : Buffer.from(sources.get(name))) : body;
};
const read = fs.promises.readFile.bind(fs.promises), readSync = fs.readFileSync.bind(fs);
fs.promises.readFile = async (path, ...args) => replace(path, await read(path, ...args));
fs.readFileSync = (path, ...args) => replace(path, readSync(path, ...args));
syncBuiltinESMExports();
