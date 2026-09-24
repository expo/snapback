import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use personas alice
table posts:
  at: time
  public
table likes:
  postId: posts
  selected: bool
  public
query one(id: posts):
  return posts[id]
`;
async function until(check) {
  const end = Date.now() + 60000;
  do { if (await check()) return; await delay(20); } while (Date.now() < end);
  throw Error("adoption/watch did not converge");
}
for (const tier of ["sqlite", "wasm"]) for (const synced of [false, true]) {
  test(`column activation: ${tier}, ${synced ? "device" : "server"} watch`, { timeout: 180000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), "sb4-column-adoption-"));
    mkdirSync(join(dir, "snapback"));
    const path = join(dir, "snapback/schema.q");
    const before = synced ? source.replace("  at: time", "  at: time\n  sync public") : source;
    writeFileSync(path, before);
    // Keep one serving process: a schema save activates under live watches.
    const child = spawn(binary, ["dev", "--port", "0", "--hold-schedules"], {cwd: dir, stdio: ["ignore", "pipe", "pipe"]});
    const exited = once(child, "exit");
    let log = "", url, client, core;
    const watches=[];
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log += bytes; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    t.after(async () => { for(const watch of watches)watch.close(); await client?.close(); if (child.exitCode == null && child.signalCode == null) child.kill(); await exited; rmSync(dir,{recursive:true,force:true}); });
    await until(() => { assert.equal(child.exitCode,null,log); return url; });
    const headers = {"x-snapback-persona":"alice", "content-type":"application/json"};
    const seed = await fetch(url+"/seed", {method:"POST",headers,body:JSON.stringify([
      {table:"posts",row:{id:"p",at:1}}, {table:"likes",row:{id:"l",postId:"p",selected:true}},
      {table:"posts",row:{id:"unselected",at:2}}, {table:"likes",row:{id:"u",postId:"unselected",selected:false}},
      {table:"posts",row:{id:"zero",at:3}},
    ])});
    assert.equal((await seed.json()).seeded,5);
    const opener = tier === "sqlite" ? processDevice({binary,dir:join(dir,"device")})
      : webDevice({wasm:readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm")),persist:memoryPersistence()});
    const between = [];
    client = await createLocalClient({url,persona:"alice",waitSeconds:1,device:{open:async(...args)=>{
      core = await opener.open(...args);
      return {close:()=>core.close(),call:async request=>{
        const reply = await core.call(request);
        if (request.op === "adopt" && synced) {
          const read = await core.call({op:"query",name:"one",viewer:"dev:alice",args:{id:"p"},now:1000});
          between.push(read);
          assert.equal(read.ok?.denied?.code,"E_PREDICT",`no old image with implicit zero between adoption and snapshot: ${JSON.stringify(read)}`);
        }
        return reply;
      }};
    }}});
    const seen=[];
    for(const id of ["p","unselected","zero"]){
      const watch=client.observe({kind:"query",name:"one"},{id});
      watches.push(watch);
      // A stale notification may bridge a fetch before generation discovery;
      // this assertion examines newly served answers, not that previous value.
      watch.subscribe(()=>{const read=watch.getSnapshot();if(read.data && read.fresh)seen.push(structuredClone(read.data));});
    }
    await until(()=>watches.every(w=>w.getSnapshot().data?.id));
    // The zero parent must remain physically untouched by both activations.
    execFileSync("python3",["-c",`import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("CREATE TRIGGER zero_untouched BEFORE UPDATE ON r WHEN OLD.t=(SELECT num FROM _catalog WHERE name='posts') AND OLD.id='zero' BEGIN SELECT RAISE(ABORT,'zero parent written'); END")
`,join(dir,".snapback4/store.sqlite")]);
    const after = before.replace("  at: time", "  at: time\n  likeCount: count likes by postId");
    seen.length=0;
    writeFileSync(path,after);
    await until(()=>watches.every((w,i)=>w.getSnapshot().data?.likeCount === [1,1,0][i]))
      .catch(error=>{throw Error(`${error.message}; reads=${JSON.stringify(between)}; seen=${JSON.stringify(seen)}; server=${log}`)});
    assert.ok(seen.length>=3);
    for(const row of seen){
      assert.ok(Object.hasOwn(row,"likeCount"),`served parent lacks maintained field: ${JSON.stringify(row)}`);
      assert.equal(row.likeCount,row.id==="zero"?0:1);
    }
    seen.length=0;
    // Only unselected contributions: a nonzero value must be rewritten to zero.
    writeFileSync(path,after.replace("count likes by postId", "count likes where .selected by postId"));
    await until(()=>watches.every((w,i)=>w.getSnapshot().data?.likeCount === [1,0,0][i]));
    assert.ok(seen.length>0);
    for(const row of seen)assert.ok(Object.hasOwn(row,"likeCount"),`served parent lacks maintained field: ${JSON.stringify(row)}`);
    const stored=JSON.parse(execFileSync("python3",["-c",`import sqlite3,json,sys
with sqlite3.connect(sys.argv[1]) as db:
 print(db.execute("SELECT data FROM r WHERE t=(SELECT num FROM _catalog WHERE name='posts') AND id='zero'").fetchone()[0])
`,join(dir,".snapback4/store.sqlite")],{encoding:"utf8"}));
    assert.ok(!Object.hasOwn(stored.Row,"likeCount"));
    if (synced) { await until(()=>between.length===2); assert.equal(between.length,2); }
    else assert.ok(seen.some(row=>row.id === "unselected" && row.likeCount === 0),"server-run watch reruns on the parent barrier");
  });
}
