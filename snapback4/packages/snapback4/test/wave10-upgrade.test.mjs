import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { settleMutation } from '../dist/write-settlement.js';
import { sentResult, matchRead, otherwiseAll } from '../dist/contract.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const invoke = (args, cwd, env = {}) => spawnSync(bin, args, { cwd, encoding: 'utf8', env: { ...process.env, SNAPBACK4_BIN: bin, PORT_LO: undefined, PORT_HI: undefined, ...env }, timeout: 120000 });
const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const project = (t, name = 'dx10-') => { const dir = mkdtempSync(join(root, 'target', name)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

const aggregates = `use personas alice, bob
 table orders:
  owner: principal
  cents: int
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
view qtySum: sum orders of .cents by .owner
  read <- .owner = viewer
  online only
view qtyCount: count orders by .owner
  read <- .owner = viewer
  online only
query roomCount(owner: principal):
  return qtyCount[owner]
mutation add(cents: int):
  return insert orders { owner: viewer, cents }
`.replace(' table orders:', 'table orders:');

test('first check after version change reports new notes, API nullability and refusals without erasing the baseline', t => {
  const dir = project(t); mkdirSync(join(dir, 'snapback')); const schema = join(dir, 'snapback/schema.q'); writeFileSync(schema, aggregates);
  success(invoke(['check'], dir));
  const path = join(dir, '.snapback4/check-surface.json'), saved = JSON.parse(readFileSync(path));
  const old = { ...saved, version: '0.4.24', notes: {}, api: saved.api.replaceAll('number | null', 'number') };
  writeFileSync(path, JSON.stringify(old));
  const changed = invoke(['check'], dir); success(changed);
  assert.match(changed.stdout, /upgrade delta: 0\.4\.24 → 0\.4\.25/);
  assert.match(changed.stdout, /N_MAINTAIN_AUTHORIZATION \+1/);
  assert.match(changed.stdout, /Ops\.roomCount\.result: number → number \| null/);
  const again = invoke(['check'], dir); success(again); assert.ok(!again.stdout.includes('upgrade delta'));
  writeFileSync(path, JSON.stringify(old));
  writeFileSync(schema, aggregates + `table totals:
  total: int
  public
  insert <- allow
mutation copy(owner: principal):
  return insert totals { total: qtySum[owner] }
`);
  const apiBefore = readFileSync(join(dir, 'snapback/generated/api.ts'), 'utf8');
  const refused = invoke(['check', '--json'], dir); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /schema also changed/); assert.match(refused.stderr, /new refusals: E_QUARRY_TYPE \+1/);
  assert.match(JSON.parse(refused.stdout).problems[0].rewrite, /qtySum\[owner\] \?\? 0/);
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(old)); assert.equal(readFileSync(join(dir, 'snapback/generated/api.ts'), 'utf8'), apiBefore);
  writeFileSync(schema, readFileSync(schema, 'utf8').replace('total: qtySum[owner]', 'total: qtySum[owner] ?? 0'));
  success(invoke(['check'], dir));
});

test('upgrade captures the old installed compiler, checks the new one and points Exact at its rebuild', t => {
  const dir = project(t); mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/schema.q'), aggregates);
  success(invoke(['check'], dir));
  const oldApi = readFileSync(join(dir, 'snapback/generated/api.ts'), 'utf8').replaceAll('number | null', 'number');
  const packageRoot = join(dir, 'node_modules/snapback4'); mkdirSync(join(packageRoot, 'bin'), { recursive: true }); mkdirSync(join(packageRoot, 'dist'));
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'snapback4', version: '0.4.24', exports: { './bin-path': './dist/bin-path.js' } })); writeFileSync(join(packageRoot, 'dist/bin-path.js'), '');
  writeFileSync(join(packageRoot, 'bin/snapback4.js'), `const fs=require('fs'); const p=require('../package.json'); if(p.version==='0.4.24'){fs.writeFileSync('snapback/generated/api.ts',${JSON.stringify(oldApi)});console.log(JSON.stringify({ok:true,notes:[]}));}else{const r=require('child_process').spawnSync(${JSON.stringify(bin)},process.argv.slice(2),{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status);}`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'npm@10', dependencies: { snapback4: '0.4.24' } }));
  writeFileSync(join(dir, 'exact.mjs'), '// Exact application marker; HS owns the rebuild implementation.');
  mkdirSync(join(dir, 'tools'));
  writeFileSync(join(dir, 'tools/npm'), `#!${process.execPath}\nconst fs=require('fs');if(process.argv[2]==='view'){console.log('"0.4.25"');}else{for(const file of ['package.json','node_modules/snapback4/package.json']){const p=JSON.parse(fs.readFileSync(file));if(p.dependencies)p.dependencies.snapback4='0.4.25';else p.version='0.4.25';fs.writeFileSync(file,JSON.stringify(p));}}`, { mode: 0o755 });
  const result = invoke(['upgrade'], dir, { PATH: `${join(dir, 'tools')}:${process.env.PATH}` }); success(result);
  assert.match(result.stdout + result.stderr, /Ops\.roomCount\.result: number → number \| null/);
  assert.match(result.stdout, /Exact device rebuild: bun exact\.mjs snapback --rebuild/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.snapback4/check-surface.json'))).version, '0.4.25');
});


test('module-only backends compile and participate in upgrade qualification', t => {
  const dir = project(t); mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/notes.q'), aggregates);
  success(invoke(['check'], dir));
  assert.match(readFileSync(join(dir, 'snapback/generated/api.ts'), 'utf8'), /roomCount/);
  // A failing installation helper must not erase the old compiler baseline.
  const old = readFileSync(join(dir, '.snapback4/check-surface.json'), 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'npm@10', dependencies: { snapback4: '0.4.25' } }));
  mkdirSync(join(dir, 'node_modules')); symlinkSync(join(root, 'packages/snapback4'), join(dir, 'node_modules/snapback4'));
  mkdirSync(join(dir, 'tools')); writeFileSync(join(dir, 'tools/npm'), `#!${process.execPath}\nprocess.exit(1);`, { mode: 0o755 });
  const result = invoke(['upgrade'], dir, { PATH: `${join(dir, 'tools')}:${process.env.PATH}` }); assert.equal(result.status, 1);
  assert.match(result.stderr, /E_UPGRADE/); assert.equal(JSON.parse(readFileSync(join(dir, '.snapback4/check-surface.json'))).sources[0][0], 'notes.q');
});

test('upgrade resolves the new compiler after a pnpm-style package symlink replacement', t => {
  const dir=project(t);mkdirSync(join(dir,'snapback'));writeFileSync(join(dir,'snapback/schema.q'),aggregates);success(invoke(['check'],dir));
  const oldApi=readFileSync(join(dir,'snapback/generated/api.ts'),'utf8').replaceAll('number | null','number');
  mkdirSync(join(dir,'node_modules'));mkdirSync(join(dir,'tools'));
  for(const [folder,version] of [['old','0.4.24'],['new','0.4.25']]){
    const pack=join(dir,folder);mkdirSync(join(pack,'dist'),{recursive:true});mkdirSync(join(pack,'bin'));
    writeFileSync(join(pack,'package.json'),JSON.stringify({name:'snapback4',version,exports:{'./bin-path':'./dist/bin-path.js'}}));writeFileSync(join(pack,'dist/bin-path.js'),'');
    writeFileSync(join(pack,'bin/snapback4.js'),folder==='old'?`require('fs').writeFileSync('snapback/generated/api.ts',${JSON.stringify(oldApi)});console.log(JSON.stringify({ok:true,notes:[]}));`:`const r=require('child_process').spawnSync(${JSON.stringify(bin)},process.argv.slice(2),{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status);`);
  }
  symlinkSync(join(dir,'old'),join(dir,'node_modules/snapback4'));
  writeFileSync(join(dir,'package.json'),JSON.stringify({packageManager:'pnpm@10',dependencies:{snapback4:'0.4.24'}}));
  writeFileSync(join(dir,'tools/pnpm'),`#!${process.execPath}\nconst fs=require('fs');if(process.argv[2]==='view'){console.log('"0.4.25"')}else{const p=JSON.parse(fs.readFileSync('package.json'));p.dependencies.snapback4='0.4.25';fs.writeFileSync('package.json',JSON.stringify(p));fs.unlinkSync('node_modules/snapback4');fs.symlinkSync(${JSON.stringify(join(dir,'new'))},'node_modules/snapback4');}`,{mode:0o755});
  const result=invoke(['upgrade'],dir,{PATH:`${join(dir,'tools')}:${process.env.PATH}`});success(result);
  assert.match(result.stdout+result.stderr,/Ops\.roomCount\.result: number → number \| null/);
  assert.equal(JSON.parse(readFileSync(join(dir,'.snapback4/check-surface.json'))).version,'0.4.25');
});
