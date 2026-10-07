import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {loadWasm} from './helpers/published-capabilities.mjs';
import {hangBudget} from './helpers/wait.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const published=process.env.RX_PUBLISHED_ROOT;
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const unsupported=/rule-reference-v2|unknown variant [`'"]?ReferenceChain/;

for(const shape of ['chain','final']) test(`published 0.4.13 rejects RX ${shape} on initial device open, persisted reopen and engine store`,{
  skip:!published?'set RX_PUBLISHED_ROOT to verified extracted snapback4 and the host platform 0.4.13 packages':false,
  timeout:hangBudget(5),
},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sb4-rx-fence-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'snapback'));
  const rule=shape==='chain'?'insert <- .message.root.owner = viewer':'insert <- allow\n  after insert <- exists roots[.message.root]';
  writeFileSync(join(dir,'snapback/schema.q'),`use personas alice\ntable roots:\n  owner: principal\n  public\n  sync public\ntable messages:\n  root: roots\n  public\n  sync public\ntable children:\n  message: messages\n  public\n  ${rule}\n  sync public\nmutation noop():\n  return true\n`);
  const run=(bin,args,input='')=>spawnSync(bin,args,{cwd:dir,input,encoding:'utf8',timeout:hangBudget()});
  const made=run(binary,['run','noop','{}','--as','alice']);
  assert.equal(made.status,0,made.stdout+made.stderr);
  const path=join(dir,'.snapback4/store.sqlite');
  const db=new DatabaseSync(path,{readOnly:true});
  const stored=db.prepare('SELECT generation,schema FROM _generations ORDER BY generation DESC LIMIT 1').get();db.close();
  const backend={generation:stored.generation,schema:JSON.parse(stored.schema),programs:[]};
  const caps=Object.values(backend.schema.tables).flatMap(t=>t.constraints).flatMap(c=>c.Capabilities??[]);
  assert.ok(caps.includes('rule-reference-v2'));
  const oldBinary=join(published,`snapback4-${process.platform}-${process.arch}/package/snapback4`);
  assert.match(run(oldBinary,['--version']).stdout,/0\.4\.13/);
  const legacy=await loadWasm(join(published,'snapback4/package/dist/wasm'));
  const current=await loadWasm(join(root,'packages/snapback4/src/wasm'));
  assert.throws(()=>new legacy(JSON.stringify(backend),'[]'),unsupported);
  const device=new current(JSON.stringify(backend),'[]');
  const kept=device.drain();device.free();
  assert.throws(()=>new legacy(undefined,kept),unsupported);
  const reopened=new current(undefined,kept);reopened.free();
  const file=join(dir,'backend.json');writeFileSync(file,JSON.stringify(backend));
  const fresh=run(oldBinary,['device',join(dir,'old.sqlite'),file]);
  assert.notEqual(fresh.status,0);assert.match(fresh.stdout+fresh.stderr,unsupported);
  const currentPath=join(dir,'current.sqlite');
  const opened=run(binary,['device',currentPath,file]);assert.equal(opened.status,0,opened.stdout+opened.stderr);
  const before=readFileSync(currentPath);
  const oldOpen=run(oldBinary,['device',currentPath]);assert.notEqual(oldOpen.status,0);assert.match(oldOpen.stdout+oldOpen.stderr,unsupported);
  assert.deepEqual(readFileSync(currentPath),before);
  const beforeStore=readFileSync(path);
  const doctor=run(oldBinary,['doctor','--store',path]);assert.notEqual(doctor.status,0);assert.match(doctor.stdout+doctor.stderr,unsupported);
  assert.deepEqual(readFileSync(path),beforeStore);
});
