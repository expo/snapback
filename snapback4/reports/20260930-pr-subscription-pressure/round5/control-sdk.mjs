// Run from snapback4/. Isolate historical SDK sources; keep real current devices/server.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import ts from 'typescript';
const [revision = 'b131c89893', name = 'pr-round4'] = process.argv.slice(2);
const target = `target/${name}`;
mkdirSync(target, { recursive: true });
cpSync('packages/snapback4/dist', `${target}/dist`, { recursive: true });
writeFileSync(`${target}/package.json`, execFileSync('git', ['show', `${revision}:snapback4/packages/snapback4/package.json`]));
const files = execFileSync('git', ['-C', '..', 'ls-tree', '-r', '--name-only', revision, '--', 'snapback4/packages/snapback4/src'], { encoding: 'utf8' }).trim().split('\n');
if (!files.some(file => file.endsWith('/local.ts'))) throw new Error('empty SDK source inventory');
for (const file of files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))) {
  const source = execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' });
  const output = `${target}/dist/${file.split('/src/')[1].replace(/\.ts$/, '.js')}`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true,
  } }).outputText);
}
console.log(JSON.stringify({ revision, target }));
