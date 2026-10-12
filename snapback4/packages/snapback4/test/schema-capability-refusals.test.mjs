// @ref LLP 3000.033#1.3 — the Darwin fence's fixture kinds also exercise Linux refusal storage.
// Refusal preserves schema/rows, integrity and freelist count. Rollback may
// change free-page contents or retain journal/WAL residue; the Rust spill
// regression exercises those physical exceptions (LLP 3000.033 §1.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedSpawnSync as spawnSync} from './helpers/fixture-command.mjs';
import {hangBudget} from './helpers/wait.mjs';
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {server,binary} from './helpers/app-server.mjs';
import {processDevice} from '../dist/native.js';
const engine=await processDevice({binary,dir:process.cwd()}).engineInfo();
import {fixtures} from './helpers/schema-capability-fixtures.mjs';

function dump(path) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    const tables=['sqlite_schema',...db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r=>r.name)];
    const integrity=db.prepare('PRAGMA integrity_check').all();
    assert.deepEqual(integrity.map(row=>row.integrity_check),['ok']);
    return JSON.stringify({tables:tables.map(name=>[name,db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()]),integrity,freelist:db.prepare('PRAGMA freelist_count').get()});
  } finally {db.close();}
}
function native(dir,path,backend,requests=[]) {
  const file=join(dir,'backend.json');
  if(backend)writeFileSync(file,JSON.stringify(backend));
  const result=spawnSync(binary,['device',path,...(backend?[file]:[])],{input:requests.map(r=>JSON.stringify(r)+'\n').join(''),encoding:'utf8',timeout:hangBudget(),killSignal:'SIGKILL'});
  const replies=result.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  return {...result,replies};
}
async function request(url,path,body) {
  const response=await fetch(url+path,{method:body?'POST':'GET',headers:{'x-snapback-persona':'alice','x-snapback-device':JSON.stringify(engine),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const json=await response.json();assert.equal(response.status,200,JSON.stringify(json));return json;
}

// Two servers, four HTTP operations and six native device invocations. Keep
// the existing client work allowance; this does not measure launch latency.
for(const f of fixtures)test(`refused native open and adoption preserve the ${f.name} fixture`,{timeout:hangBudget(12)},async t=>{
  const old=await server(t,undefined,f.plain), next=await server(t,undefined,f.source);
  await request(old.url,'/seed',f.seed);
  const prior=await request(old.url,'/schema'), candidate=await request(next.url,'/schema');
  candidate.generation=prior.generation+1;
  const capabilities=Object.values(candidate.schema.tables).flatMap(table=>table.constraints??[]).filter(c=>c?.Capabilities).flatMap(c=>c.Capabilities);
  for(const capability of f.capabilities)assert.ok(capabilities.includes(capability),`${f.name}: ${capability}`);
  const future=structuredClone(candidate);
  Object.values(future.schema.tables).flatMap(table=>table.constraints??[]).find(c=>c?.Capabilities).Capabilities.push('future-derivation');
  const page=await request(old.url,'/sync',{from:0,limit:10000,pending:[]});
  const query={op:'query',name:f.query,viewer:'dev:alice',args:{},now:1000};
  for(const mode of ['WAL','DELETE']) {
    const path=join(old.dir,`${mode}.sqlite`);
    const seeded=native(old.dir,path,prior,[{op:'apply',page,first:true,viewer:'dev:alice'},query]);
    assert.equal(seeded.status,0,seeded.stdout+seeded.stderr);
    assert.ok(seeded.replies[2].ok.data.length>0,'preserve real fixture rows');
    const db=new DatabaseSync(path);
    db.exec(`DROP TABLE IF EXISTS _read_sessions; PRAGMA journal_mode=${mode}`);
    db.close();
    const before=dump(path);
    const refused=native(old.dir,path,null,[{op:'adopt',backend:future},query]);
    assert.equal(refused.status,0,refused.stdout+refused.stderr);
    assert.equal(refused.replies[1].denied.code,'E_SCHEMA_CAPABILITY');
    assert.deepEqual(refused.replies[2],seeded.replies[2]);
    assert.equal(dump(path),before,`${mode}: full schema and row dump`);

    const corrupted=new DatabaseSync(path);
    corrupted.prepare("UPDATE _meta SET value=? WHERE key='device:backend'").run(JSON.stringify(future));
    corrupted.exec('DROP TABLE _effect_steps');corrupted.close();
    const beforeOpen=dump(path);
    const rejected=native(old.dir,path,null);
    assert.notEqual(rejected.status,0);
    assert.match(rejected.stdout+rejected.stderr,/E_SCHEMA_CAPABILITY/);
    assert.equal(dump(path),beforeOpen,`${mode}: rejected open leaves every table and row`);
  }
});
