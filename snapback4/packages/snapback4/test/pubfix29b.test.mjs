import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startDev } from '../dist/proof.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const wrapper = join(root, 'packages/snapback4/bin/snapback4.js');
const fixture = t => {
  const cwd = mkdtempSync(join(tmpdir(), 'sb4-pubfix29b-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};
const invoke = (cwd, args, env = {}) => spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, PORT_LO: undefined, PORT_HI: undefined, ...env } });
const okay = result => assert.equal(result.status, 0, result.stdout + result.stderr);
test('D1 every UI starter frontend proof and launcher refuses one port before starting children', { timeout: 60_000 }, t => {
  for (const flags of [['--web'], ['--web','--online'], ['--expo'], ['--web','--template','chat'], ['--expo','--template','chat'], ['--template','social']]) {
    const cwd = fixture(t);
    okay(invoke(cwd, [flags.includes('social') ? 'new' : 'init', '.', ...flags]));
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'));
    const logs = join(cwd, 'logs');
    for (const args of [['scripts/frontend-proof.mjs'], ['scripts/launch.mjs', flags.includes('--web') ? 'vite' : 'expo-web']]) {
      const result = spawnSync(process.execPath, args, { cwd, encoding:'utf8', timeout: 10_000,
        env: { ...process.env, PORT_LO:'26005', PORT_HI:'26005', SNAPBACK4_BIN: '/no-binary-should-start', SNAPBACK4_PROOF_LOGS: logs } });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /the starter needs two runtime ports/);
      assert.doesNotMatch(result.stderr, /E_ADDRINUSE|proof child exited|ENOENT/);
    }
  }
});

test('H2 web-shell help lists the verb and has no filesystem side effects', t => {
  const cwd = fixture(t);
  const help = spawnSync(process.execPath, [wrapper, '--help'], { cwd, encoding:'utf8', env:{...process.env,SNAPBACK4_BIN:binary} });
  okay(help); assert.match(help.stdout, /web-shell <dir>/);
  for (const flag of ['--help','-h']) {
    const result = spawnSync(process.execPath, [wrapper,'web-shell',flag], { cwd, encoding:'utf8',env:{...process.env,SNAPBACK4_BIN:'/missing'} });
    okay(result); assert.match(result.stdout, /offline.*static web export/); assert.deepEqual(readdirSync(cwd), []);
    okay(invoke(cwd, ['web-shell',flag]));
  }
});

test('H3 retired todo recipe explains the supported starter and writes nothing', t => {
  const cwd = fixture(t);
  const result = invoke(cwd, ['init','new-app','--recipe','todo']);
  assert.equal(result.status,2); assert.match(result.stderr,/E_RECIPE_RETIRED/);
  assert.match(result.stderr,/init \[dir\] --web/); assert.match(result.stderr,/--template chat/);
  assert.deepEqual(readdirSync(cwd),[]);
});

test('H7 missing optional Playwright gives a coded install command; help needs no peer', t => {
  const cwd = fixture(t);
  mkdirSync(join(cwd,'bin')); mkdirSync(join(cwd,'dist'));
  writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
  writeFileSync(join(cwd,'bin/witness-web.js'),readFileSync(join(root,'packages/snapback4/bin/witness-web.js')));
  writeFileSync(join(cwd,'dist/client.js'),'export const idFrom = () => "unused";');
  for (const flag of ['--help','-h']) okay(spawnSync(process.execPath,['bin/witness-web.js',flag],{cwd,encoding:'utf8'}));
  const result=spawnSync(process.execPath,['bin/witness-web.js'],{cwd,encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/E_WITNESS_BROWSER:.*optional playwright-core peer/);
  assert.match(result.stderr,/npm install --save-dev playwright-core/); assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND| at /);
});

test('H8 run, doctor, clock advance and reset discover a persisted dev on a non-default port', { timeout: 30_000 }, async t => {
  const cwd=fixture(t);mkdirSync(join(cwd,'snapback'));
  writeFileSync(join(cwd,'snapback/schema.q'),"use personas alice\nquery hello():\n  return 'hello'\n");
  const dev=await startDev({cwd,args:['--no-watch'],env:{SNAPBACK4_BIN:binary,PORT_LO:undefined,PORT_HI:undefined}});
  t.after(()=>dev.stop());
  assert.notEqual(new URL(dev.url).port,'4400');
  okay(invoke(cwd,['run','hello','--as','alice']));
  okay(invoke(cwd,['doctor']));
  const clock=invoke(cwd,['clock','advance','+25h']);okay(clock);
  const advanced=await (await fetch(dev.url+'/dev/status')).json();
  const reset=invoke(cwd,['reset','--clock','reset']);okay(reset);
  assert.equal(JSON.parse(reset.stdout).reset,true);
  const after=await (await fetch(dev.url+'/dev/status')).json();
  assert.ok(advanced.clockOffsetMs > 89_000_000);
  assert.ok(Math.abs(after.clockOffsetMs) < 5000);
  okay(invoke(cwd,['clock','advance','+1s','--port',new URL(dev.url).port]));
  okay(invoke(cwd,['reset','--clock','reset','--port',new URL(dev.url).port]));
});
