// Real Quarry calendar keys and maintain cursors on wasm and the native device.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const source = "use personas alice, bob\ntable posts:\n  owner: principal\n  item: id\n  at: time\n  selected: bool\n  score: int\n  by byOwner: owner, at, id\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  sync last 1 by byOwner\nmaintain totals: sum posts of score where .selected by owner, item, day(.at)\n  read <- .owner = viewer\n  by byScore: owner, value, id\nquery groups(c: cursor ?):\n  return totals[viewer] after c first 50 by byGroup\nquery rank(c: cursor ?):\n  return totals[viewer] after c last 10 by byScore\nquery calendar(at: time):\n  return {day: day(at), hour: hour(at), bucket: bucket(at, 2m)}\nmutation lower(row: posts):\n  update posts[row] {score: 1}\n";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const tier of ["wasm", "process"]) test(tier + ": calendar endpoints, full aggregate pages past a source horizon, and rank", { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-d1-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], {cwd:dir, stdio:["ignore","pipe","pipe"]});
  const exit = once(child, "exit");
  let log = "", url, client;
  child.stdout.on("data", d => { log += d; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", d => { log += d; });
  t.after(async () => { await client?.close(); if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); await exit; rmSync(dir, {recursive:true, force:true}); });
  for (let i=0; !url && i<750; i++) { assert.equal(child.exitCode, null, log); await sleep(20); }
  assert.ok(url, log);
  const post = async (path, body) => fetch(url+path, {method:"POST", headers:{"x-snapback-persona":"bob"}, body:JSON.stringify(body)}).then(r=>r.json());
  const seed = Array.from({length:51}, (_, n) => ({table:"posts", row:{id:"p"+n, item:"i"+String(n).padStart(2,"0"), owner:"dev:bob", at:-1, selected:true, score:n+1}}));
  assert.equal((await post("/seed", seed)).seeded, 51);
  mkdirSync(join(dir,"device"));
  const opener = tier === "wasm" ? webDevice({wasm, persist:memoryPersistence()}) : processDevice({binary, dir:join(dir,"device"), spawn:(cmd,args)=>spawn(cmd,args,{stdio:["pipe","pipe","inherit"]}), writeFile:async(path,text)=>writeFileSync(path,text)});
  client = await createLocalClient({url, persona:"bob", device:opener, waitSeconds:1});
  await client.sync();
  const query = (name, args={}) => client.query({kind:"query",name}, args);
  for (const at of [-9007199254740991,-86400001,-3600001,-1,0,1,3600000,86400000,1709164800000,1710057600000,9007199254740991]) {
    const result = await query("calendar",{at});
    assert.deepEqual(result.data,{day:Math.floor(at/86400000),hour:Math.floor(at/3600000),bucket:Math.floor(at/120000)});
  }
  const first = await query("groups",{c:null});
  assert.equal(first.data.length,50); assert.equal(first.complete,true); assert.ok(first.next);
  const last = await query("groups",{c:first.next});
  assert.equal(last.data.length,1); assert.equal(last.complete,true);
  const ranks = await query("rank",{c:null});
  assert.deepEqual(ranks.data.map(r=>r.value),[51,50,49,48,47,46,45,44,43,42]);
  assert.equal((await post("/m/lower",{args:{row:"p50"},id:"lower"})).state,"sent");
  await client.sync();
  const decreased = await query("rank",{c:null});
  assert.deepEqual(decreased.data.map(r=>r.value),[50,49,48,47,46,45,44,43,42,41]);
});
