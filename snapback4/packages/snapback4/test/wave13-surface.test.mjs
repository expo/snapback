import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startServe, withBrowser } from '../dist/proof.js';
import { registerWebWitness } from '../dist/witness-web.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const fixture = t => {
  const cwd = mkdtempSync(join(tmpdir(), 'sb4-surface13-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};
const invoke = (cwd, args) => spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 30_000 });
const okay = r => assert.equal(r.status, 0, r.stdout + r.stderr);
const schema = `use identity guests\ntable notes:\n  title: text <=80\n  public 'shared'\n  insert <- allow\nquery list():\n  return notes first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { title }\n`;
test('H1/H4/H5 help agrees and ignored flags refuse before filesystem work', t => {
  const cwd = fixture(t), top = invoke(cwd, ['--help']); okay(top);
  for (const verb of ['init','new','check','device','types','dev','deploy','rollback','prune','releases','serve','run','clock','reset','test','why','guide','data','sql','token','doctor','upgrade','witness']) {
    const help = invoke(cwd, [verb,'--help']); okay(help);
    assert.ok(top.stdout.split('\n').map(s=>s.trim()).includes(help.stdout.split('\n')[0]), verb);
  }
  for (const flags of [['serve','deploy','--now','1'], ['serve','deploy','--resume-clock'], ['serve','deploy','--replay'], ['serve','deploy','--clock-offset','1'], ['check','--url','notaurl'], ['check','--release','1'], ['types','--json'], ['why','E_INPUT','--json'], ['why','E_INPUT','--instance','a'], ['reset','--release','deploy']]) {
    const r = invoke(cwd, flags); assert.equal(r.status, 2, r.stderr); assert.match(r.stderr,/E_INPUT:/);
  }
  assert.deepEqual(readdirSync(cwd), []);
  const serve = invoke(cwd,['serve','--help']).stdout;
  assert.doesNotMatch(serve, /--now|--clock-offset|--resume-clock|--replay/);
  assert.match(top.stdout,/init .*--port-range/);
  assert.match(invoke(cwd,['deploy','--help']).stdout.split('\n')[0],/--schema file.q/);
});
test('token quiet/JSON and empty/nonempty data JSON have machine-readable output; releases preserve provenance', t => {
  const cwd = fixture(t); mkdirSync(join(cwd,'snapback')); writeFileSync(join(cwd,'snapback/schema.q'),schema);
  const began = Date.now(); okay(invoke(cwd,['deploy','deploy','--json']));
  const provenance = JSON.parse(readFileSync(join(cwd,'deploy/releases/1/provenance.json'),'utf8'));
  assert.match(provenance.sourceHash,/^[0-9a-f]{64}$/); assert.match(provenance.cliVersion,/^0\.4\./);
  assert.equal(provenance.release,1); assert.ok(provenance.createdAt >= began);
  const unchanged = invoke(cwd,['deploy','deploy','--json']); okay(unchanged); assert.equal(JSON.parse(unchanged.stdout).unchanged,true);
  let data = invoke(cwd,['data','notes','--release','deploy','--json']); okay(data); assert.deepEqual(JSON.parse(data.stdout),[]);
  const quiet = invoke(cwd,['token','--service','worker','--release','deploy','--quiet']); okay(quiet);
  assert.equal(quiet.stderr,''); assert.equal(quiet.stdout.trim().split('\n').length,1); assert.ok(quiet.stdout.trim());
  const json = invoke(cwd,['token','--service','worker','--release','deploy','--json']); okay(json);
  assert.equal(json.stderr,''); const session=JSON.parse(json.stdout); assert.ok(session.token); assert.equal(session.principal,'service:worker'); assert.ok(session.expiresAt>Date.now());
  const normal=invoke(cwd,['token','--service','worker','--release','deploy']); okay(normal); assert.doesNotMatch(normal.stderr,/—/);
  const add = invoke(cwd,['run','add','{"title":"one"}','--as','alice','--json']); okay(add);
  data=invoke(cwd,['data','notes','--json']); okay(data); assert.equal(JSON.parse(data.stdout)[0].title,'one');
  writeFileSync(join(cwd,'snapback/schema.q'),schema+'\nquery two():\n  return 2\n');
  okay(invoke(cwd,['deploy','deploy','--json']));
  const second=JSON.parse(readFileSync(join(cwd,'deploy/releases/2/provenance.json'),'utf8'));
  assert.notEqual(second.sourceHash,provenance.sourceHash);
});
test('startServe names its directory argument and witness disabled errors expose code', () => {
  for (const value of [{cwd:'.'},undefined,null,'']) assert.throws(()=>startServe(value), e=>e.code==='E_PROOF_USAGE'&&/startServe\(deployDir, options\)/.test(e.message));
  const previous=globalThis.window;
  try {
    globalThis.window={location:{search:''}};
    registerWebWitness({},{});
    assert.throws(()=>window.__snapback4Witness.beginForm('save',null,{}),e=>e.code==='E_WITNESS_DISABLED');
  } finally { if(previous===undefined) delete globalThis.window; else globalThis.window=previous; }
});
test('proof browser prefers caller-installed @playwright/test', async t => {
  const cwd=fixture(t), peer=join(cwd,'node_modules/@playwright/test'); mkdirSync(peer,{recursive:true});
  writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
  writeFileSync(join(peer,'package.json'),'{"name":"@playwright/test","exports":"./index.js"}');
  writeFileSync(join(peer,'index.js'),`module.exports={chromium:{async launch(){return {async newContext(){return {callerPeer:true,setDefaultTimeout(){},setDefaultNavigationTimeout(){},async close(){}}},async close(){}}}}};`);
  const result=await withBrowser({cwd,logsDir:join(cwd,'logs')},async context=>context.callerPeer);
  assert.equal(result,true);
});
test('guide topic aliases select sections and full long cards carry a section index',t=>{
  const cwd=fixture(t);
  for(const [word,heading] of [['identity','Deploy and password identity'],['migrations','Migrations and adoption'],['auth/headless','Seed accounts headlessly'],['backfill','Release rollback'],['fields','Column types']]){
    const result=invoke(cwd,['guide',word]);okay(result);assert.match(result.stdout,new RegExp('section .*'+heading));
    assert.ok(result.stdout.length<invoke(cwd,['guide',word,'--full']).stdout.length,word);
  }
  const long=invoke(cwd,['guide','deploy']);okay(long);assert.match(long.stdout,/deploy: \d+ lines/);assert.match(long.stdout,/guide deploy --section/);
  const social=fixture(t);const initialized=invoke(social,['new','.','--template','social']);okay(initialized);assert.doesNotMatch(initialized.stdout,/init --expo --port/);
});
