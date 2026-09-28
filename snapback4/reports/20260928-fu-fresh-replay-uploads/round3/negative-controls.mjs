// Disposable SDK copies only. Run from the repository root after package build.
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import ts from 'typescript';
const root = resolve('snapback4'), pkg = join(root, 'packages/snapback4');
const out = resolve('snapback4/reports/20260928-fu-fresh-replay-uploads/round3');
const target = join(root, 'target/fu-r3-controls');
mkdirSync(target, { recursive: true });
function copy(name) {
  const dest = join(target, name); mkdirSync(join(dest, 'test/helpers'), { recursive: true });
  for (const path of ['dist', 'src/wasm', 'package.json', 'test/overload.test.mjs', 'test/helpers/app-server.mjs']) cpSync(join(pkg, path), join(dest, path), { recursive: true });
  if (!existsSync(join(dest, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(dest, 'node_modules'), 'dir');
  return dest;
}
function run(name, dest, pattern) {
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern='+pattern, join(dest,'test/overload.test.mjs')], { env: { ...process.env, SNAPBACK4_BIN: join(root,'target/debug/snapback4') }, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(out, name+'.log'), result.stdout + result.stderr);
  const failed = [...result.stdout.matchAll(/^✖ (.+?) \(/gm)].map(m=>m[1]);
  const record = { name, exit: result.status, signal: result.signal, error: result.error?.message, failed: [...new Set(failed)] };
  console.log(JSON.stringify(record));
  if (result.status !== 1 || !record.failed.length) throw Error('negative control did not fail as expected: '+name);
  return record;
}
const old = copy('round2');
for (const name of ['client', 'local', 'ephemeral']) {
  const source = execFileSync('git', ['show', `7c94f7126:snapback4/packages/snapback4/src/${name}.ts`], { encoding: 'utf8' });
  const built = ts.transpileModule(source, { fileName: name+'.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true } });
  writeFileSync(join(old,'dist',name+'.js'), built.outputText);
}
const results = [run('round2-negative', old, 'startup rotation|public ephemeral|concurrent public|probe recovery')];
const jitter = copy('constant-jitter');
const path = join(jitter, 'dist/http-response.js'), source = readFileSync(path, 'utf8');
const needle = 'delay * (1 + Math.random() * 0.25)';
if (!source.includes(needle)) throw Error('missing jitter implementation');
writeFileSync(path, source.replace(needle, 'delay * 1.125'));
results.push(run('constant-jitter-negative', jitter, 'concurrent public'));
if (results[1].failed.length !== 8) throw Error('all eight public paths must reject synchronized retries');
writeFileSync(join(out,'negative-controls.json'),JSON.stringify(results,null,2)+'\n');
