// @ref LLP 3000.011.003.000.000#9-wave-13-saved-version-proofs-day3-2026-10-16 — generated proofs cannot claim success without business evidence or their own build.
import test from "node:test";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, command, deploy, rollback, testSource, startServe } from "../dist/proof.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
process.env.SNAPBACK4_BIN ??= join(root, "target/debug/snapback4");
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-day3-proof-"));
  mkdirSync(join(cwd, "node_modules"));
  symlinkSync(join(root, "packages/snapback4"), join(cwd, "node_modules/snapback4"), "dir");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
test("proof usage guards report actual received values", () => {
  assert.throws(() => deploy("deploy", undefined), /got undefined.*versions\/v1/);
  assert.throws(() => testSource(null), /got null/);
  assert.throws(() => rollback("deploy", {}), /got \{\}/);
});
test("generated default day-two proof conserves storage and releases its hosts", async t => {
  const cwd = fixture(t);
  assert.equal((await cli(["init", "--web"], { cwd })).code, 0);
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
  assert.match(pkg.scripts["day2:proof"], /versions\/v1 versions\/v2$/);
  const result = await command(process.execPath, ["scripts/day2-proof.mjs", "versions/v1", "versions/v2"], { cwd, timeoutMs: 180_000 });
  assert.equal(result.code, 0,result.stderr);
  assert.match(result.stdout, /day2:proof passed/);
});
test("frontend proof invokes its own build before starting any host", async t => {
  const cwd = fixture(t);
  assert.equal((await cli(["init", "--web"], { cwd })).code, 0);
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
  pkg.scripts.build = "node build.mjs";
  writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(cwd, "build.mjs"), 'import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("dist");writeFileSync("dist/index.html","fresh build");process.exitCode=17;');
  assert.ok(!existsSync(join(cwd, "dist")));
  const result = await command(process.execPath, ["scripts/frontend-proof.mjs"], { cwd, timeoutMs: 60_000 });
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(join(cwd, "dist/index.html"), "utf8"), "fresh build");
  assert.match(result.stderr, /frontend:proof build failed/);
});

test("expiry recovery refuses while the deployment owner is serving", async t => {
  const cwd = fixture(t);
  assert.equal((await cli(["init", "--web"], { cwd })).code, 0);
  await deploy("deployment", "versions/v1/schema.q", { cwd });
  const serve = await startServe("deployment", { cwd });
  try {
    const result = await cli(["doctor", "--release", "deployment", "--repair-expiry-orphan", "parents:p"], { cwd });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /E_STORE_IN_USE|owned|owner|serving/);
  } finally { await serve.stop(); }
});

// The emitted npm defaults, direct argv form and explicit destination share one parser.
test("day-two destination works with direct args and npm defaults", async t => {
  const cwd = fixture(t);
  assert.equal((await cli(["init", "--web"], { cwd })).code, 0);
  for (const [binary,args] of [[process.execPath,["scripts/day2-proof.mjs","versions/v1","versions/v2","./direct-deploy"]],["npm",["run","day2:proof","--","./npm-deploy"]]]) {
    const result = await command(binary,args,{cwd,timeoutMs:180_000});
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/day2:proof passed/);
    assert.doesNotMatch(result.stderr,/usage:/);
  }
  assert.ok(existsSync(join(cwd,"direct-deploy/store.sqlite")));
  assert.ok(existsSync(join(cwd,"npm-deploy/store.sqlite")));
});

// @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — explicit v1 writes never excuse rollback-hidden or resurrected ids.
async function deletionScenario(t, mode) {
  const cwd=fixture(t);
  assert.equal((await cli(["init","--web"],{cwd})).code,0);
  const old=`table docs:
  body: text <=40
  stable: int default 7
  public 'proof fixture'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only
mutation add(body: text <=40):
  return insert docs {body}
mutation edit(id: docs, body: text <=40):
  return update docs[id] {body}
mutation remove(id: docs):
  delete docs[id]
  return true
invariant docs always .body = null or .body != null
`;
  const next=old.replace("body: text <=40\n","body: text <=40 ?\n")+"mutation native():\n  return insert docs {body:null}\n";
  for(const [name,source] of [["v1",old],["v2",next]]) {
    writeFileSync(join(cwd,`versions/${name}/schema.q`),source);
    rmSync(join(cwd,`versions/${name}/fixtures`),{recursive:true,force:true});
  }
  const path=join(cwd,"scripts/day2-proof.mjs");let script=readFileSync(path,"utf8");
  assert.match(script,/deletedByV1/);
  const hook=`  const state=globalThis.relDay2 ??= {round:0,forwardChecks:0};
  const token=await serve.operatorToken();
  const write=async(op,args)=>{
    const response=await fetch(url+'/m/'+op,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200);const reply=await response.json();assert.equal(reply.state,'sent',JSON.stringify(reply));return reply.result;
  };
  if(release==='v1') {state.first=await write('add',{body:'remove first'});state.keep=await write('add',{body:'keep'});}
  if(release==='v2') {state.v2Fixed=true;state.native=await write('native',{});}
  if(release==='rollback-v1') {
    state.round++;
    if(${JSON.stringify(mode)}==='missing') return [{id:'docs/not-visible',fields:[],deleted:true}];
    if(state.round===1) {
      await write('remove',{id:state.first.id});await write('edit',{id:state.keep.id,body:'edited'});
      state.oldBorn=await write('add',{body:'v1-born'});
      return [{id:'docs/'+state.first.id,fields:[],deleted:true},{id:'docs/'+state.keep.id,fields:['body']}];
    }
    if(${JSON.stringify(mode)}==='resurrection') return [{id:'docs/'+state.first.id,fields:[],deleted:true}];
    await write('remove',{id:state.keep.id});return [{id:'docs/'+state.keep.id,fields:[],deleted:true}];
  }
  if(release==='forward-v2') {
    if(['forward-resurrection','forward-value','v1-born-loss'].includes(${JSON.stringify(mode)})) state.forwardCleaned=true;
    state.forwardChecks++;const rows=await snapshotAll();
    assert.ok(!rows.has('docs/'+state.first.id));
    assert.equal(rows.get('docs/'+state.native.id).body,null);
    assert.equal(rows.get('docs/'+state.oldBorn.id).body,'v1-born');
    if(state.round===1) assert.equal(rows.get('docs/'+state.keep.id).body,'edited');
    else assert.ok(!rows.has('docs/'+state.keep.id));
  }
  return [];`;
  script=script.replace(/  \/\/ BUSINESS_ASSERTION_BEGIN[\s\S]*?  \/\/ BUSINESS_ASSERTION_END/,()=>hook);
  if(mode==='resurrection') {
    // Inject one observed rollback resurrection before its callback. An old
    // callback that declares/deletes it again must not conceal this fault.
    script=script.replace("  return rows;\n}","  if(status.live?.exact===false && globalThis.relDay2?.forwardChecks && globalThis.relDay2.round===1) rows.set('docs/'+globalThis.relDay2.first.id,globalThis.relDay2.first);\n  return rows;\n}");
  }
  if(mode==='forward-resurrection') script=script.replace("  return rows;\n}","  if(status.live?.exact===true && globalThis.relDay2?.round===1 && !globalThis.relDay2.forwardCleaned) rows.set('docs/'+globalThis.relDay2.first.id,globalThis.relDay2.first);\n  return rows;\n}");
  if(mode==='forward-value') script=script.replace("  return rows;\n}","  if(status.live?.exact===true && globalThis.relDay2?.round===1 && !globalThis.relDay2.forwardCleaned) {const id='docs/'+globalThis.relDay2.keep.id;rows.set(id,{...rows.get(id),stable:8});}\n  return rows;\n}");
  if(mode==='initial-loss') script=script.replace("  return rows;\n}","  if(status.live?.exact===true && status.release!==1 && globalThis.relDay2?.first && !globalThis.relDay2.v2Fixed) rows.delete('docs/'+globalThis.relDay2.first.id);\n  return rows;\n}");
  if(mode==='v1-born-loss') script=script.replace("  return rows;\n}","  if(status.live?.exact===true && globalThis.relDay2?.round===1 && !globalThis.relDay2.forwardCleaned) rows.delete('docs/'+globalThis.relDay2.oldBorn.id);\n  return rows;\n}");
  if(mode==='v1-born-rollback-loss') script=script.replace("  return rows;\n}","  if(status.live?.exact===false && globalThis.relDay2?.round===1 && globalThis.relDay2.forwardChecks) rows.delete('docs/'+globalThis.relDay2.oldBorn.id);\n  return rows;\n}");
  writeFileSync(path,script);
  return command(process.execPath,["scripts/day2-proof.mjs","versions/v1","versions/v2"],{cwd,timeoutMs:180_000});
}

test("day-two proof permits explicit v1 edits, inserts and deletions while retaining v2-native rows",async t=>{
  const result=await deletionScenario(t,"valid");assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/day2:proof passed/);
});
test("day-two proof rejects a deletion declaration for an already-invisible id",async t=>{
  const result=await deletionScenario(t,"missing");assert.notEqual(result.code,0);assert.match(result.stderr,/declared delete must start from a visible row/);
});
test("a later v1 callback cannot conceal a rollback resurrection",async t=>{
  const result=await deletionScenario(t,"resurrection");assert.notEqual(result.code,0);assert.match(result.stderr,/deliberate v1 delete resurrected on rollback/);
});

test("a forward callback cannot conceal a deleted-row resurrection",async t=>{
  const result=await deletionScenario(t,"forward-resurrection");assert.notEqual(result.code,0);assert.match(result.stderr,/deliberate v1 delete resurrected on forward/);
});
test("a forward callback cannot repair an untouched field before conservation",async t=>{
  const result=await deletionScenario(t,"forward-value");assert.notEqual(result.code,0);assert.match(result.stderr,/changed during release cycle/);
});
test("initial v2 callback cannot conceal predecessor-row loss",async t=>{
  const result=await deletionScenario(t,"initial-loss");assert.notEqual(result.code,0);assert.match(result.stderr,/missing persisted row/);
});

test("forward conservation checks newly inserted v1 rows before its callback",async t=>{
  const result=await deletionScenario(t,"v1-born-loss");assert.notEqual(result.code,0);assert.match(result.stderr,/missing persisted row/);
});

// Table swaps and name reuse must conserve independent populations, including
// identical row ids in different tables and a newly registered forward source.
test("day-two snapshots keep simultaneous renames distinct across release selections",async t=>{
  const cwd=fixture(t);assert.equal((await cli(["init","--web"],{cwd})).code,0);
  const script=readFileSync(join(cwd,"scripts/day2-proof.mjs"),"utf8");
  const section=script.slice(script.indexOf("const identitiesByRelease"),script.indexOf("async function snapshotAll"));
  const resolve=runInNewContext(section+";tableIdentities",{assert});
  const entries=map=>JSON.parse(JSON.stringify([...map]));
  const source=(release,declarations,key)=>resolve({release,live:{exact:true}},declarations,key);
  assert.deepEqual(entries(source(1,[["A"],["B"]],"old")),[["A","A"],["B","B"]]);
  assert.deepEqual(entries(source(2,[["B","A"],["A","B"],["fresh"]],"new")),[["B","A"],["A","B"],["fresh","fresh@2"]]);
  assert.deepEqual(entries(resolve({release:3,live:{exact:false,source:1,parent:2}},[["A"],["B"],["fresh"]],"view")),[["A","A"],["B","B"],["fresh","fresh@2"]]);
  assert.deepEqual(entries(source(4,[["B","A"],["A","B"],["fresh"]],"new")),[["B","A"],["A","B"],["fresh","fresh@2"]]);
  assert.deepEqual(entries(source(1,[["A"],["B"]],"old")),[["A","A"],["B","B"]]);
  const resolveReuse=runInNewContext(section+";tableIdentities",{assert});
  resolveReuse({release:1,live:{exact:true}},[["A"],["B"]],"old");
  assert.deepEqual(entries(resolveReuse({release:2,live:{exact:true}},[["B","A"],["C","B"],["A"]],"chain")),[["B","A"],["C","B"],["A","A@2"]]);
  for(const release of [3,5]) {
    const current=resolveReuse({release,live:{exact:false,source:1,parent:2}},[["B","A"],["C","B"],["A"]],"current-view");
    assert.deepEqual(entries(current),[["B","A"],["C","B"],["A","A@2"]]);
    const populations=new Map([...current].map(([table,identity])=>[identity+"/same-id",table]));
    assert.equal(populations.size,3);assert.equal(populations.get("A@2/same-id"),"A");
    assert.deepEqual(entries(resolveReuse({release:release+1,live:{exact:true}},[["B","A"],["C","B"],["A"]],"chain")),entries(current));
  }
  assert.deepEqual(entries(resolveReuse({release:7,live:{exact:false,source:1,parent:2}},[["A"],["B"]],"selective-view")),[["A","A"],["B","B"]]);
});

test("v1-born rows stay required on the next rollback before its callback",async t=>{
  const result=await deletionScenario(t,"v1-born-rollback-loss");assert.notEqual(result.code,0);assert.match(result.stderr,/missing persisted row/);
});
