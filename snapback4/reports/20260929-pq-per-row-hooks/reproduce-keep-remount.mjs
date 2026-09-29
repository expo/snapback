// Run from snapback4 after package build: node reports/20260929-pq-per-row-hooks/reproduce-keep-remount.mjs baseline|current [attempts]
// Isolates the SDK under this worktree's target directory; never changes active dist.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '../..');
const kind = process.argv[2] ?? 'current', attempts = Number(process.argv[3] ?? 10);
if (!['baseline', 'current'].includes(kind) || !Number.isInteger(attempts) || attempts < 1) throw Error('baseline|current [positive attempts]');
const base = 'ee514de117825183731eb0c215463f99c4775fe4';
const scratch = mkdtempSync(join(root, 'target/pq-remount-'));
try {
  cpSync(join(root, 'packages/snapback4/dist'), join(scratch, 'dist'), { recursive: true });
  cpSync(join(root, 'packages/snapback4/package.json'), join(scratch, 'package.json'));
  if (kind === 'baseline') {
    const ts = createRequire(join(root, 'packages/snapback4/package.json'))('typescript');
    for (const name of ['client', 'local', 'local-reads', 'observe-watch', 'read-expiry']) {
      const source = execFileSync('git', ['show', `${base}:snapback4/packages/snapback4/src/${name}.ts`], { cwd: root, encoding: 'utf8' });
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/(from\s+["'][^"']+)\.ts(["'])/g, '$1.js$2');
      writeFileSync(join(scratch, 'dist', name + '.js'), compiled);
    }
  }
  let source = readFileSync(join(root, 'packages/snapback4/test/keep-device.test.mjs'), 'utf8');
  source = source.replaceAll('"../dist/', '"' + join(scratch, 'dist') + '/');
  source = source.replace('resolve(import.meta.dirname, "../../../target/debug/snapback4")', JSON.stringify(join(root, 'target/debug/snapback4')));
  source = source.replace('readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url))', 'readFileSync(' + JSON.stringify(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')) + ')');
  source = source.replace('"second key ready");', '"second key ready").catch(error => { console.log("KEEP_DIAGNOSTIC", { watch: watch.getSnapshot(), idle: idle.getSnapshot(), requests, holding }); throw error; });');
  const file = join(scratch, 'repro.test.mjs');
  writeFileSync(file, source);
  for (let i = 1; i <= attempts; i++) {
    console.log(`${kind} iteration ${i}, base ${base}`);
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=^wasm: keep remount', file], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
