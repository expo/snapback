// Rebuild just the changed SDK modules at the recorded main control. Run in snapback4/.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const target = 'target/pr-main';
mkdirSync(target, { recursive: true });
cpSync('packages/snapback4/dist', target + '/dist', { recursive: true });
cpSync('packages/snapback4/package.json', target + '/package.json');
for (const file of ['local', 'local-reads', 'client', 'read-work', 'read-observation', 'read-episode', 'app-client']) {
  const source = execFileSync('git', ['show', `2cb2b5f141befd4c5dfd6afdc6c0725867f3c747:snapback4/packages/snapback4/src/${file}.ts`], { encoding: 'utf8' });
  writeFileSync(`${target}/dist/${file}.js`, ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true,
  } }).outputText);
}
