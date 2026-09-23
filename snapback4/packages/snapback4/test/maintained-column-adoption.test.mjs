import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
query one():
  return posts['p']
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
    let log = "", url, client, watch, core;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log += bytes; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    t.after(async () => { watch?.close(); await client?.close(); if (child.exitCode == null && child.signalCode == null) child.kill(); await exited; rmSync(dir,{recursive:true,force:true}); });
    await until(() => { assert.equal(child.exitCode,null,log); return url; });
    const headers = {"x-snapback-persona":"alice", "content-type":"application/json"};
    const seed = await fetch(url+"/seed", {method:"POST",headers,body:JSON.stringify([
      {table:"posts",row:{id:"p",at:1}}, {table:"likes",row:{id:"l",postId:"p",selected:false}},
    ])});
    assert.equal((await seed.json()).seeded,2);
    const opener = tier === "sqlite" ? processDevice({binary,dir:join(dir,"device")})
      : webDevice({wasm:readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm")),persist:memoryPersistence()});
    const between = [];
    client = await createLocalClient({url,persona:"alice",waitSeconds:1,device:{open:async(...args)=>{
      core = await opener.open(...args);
      return {close:()=>core.close(),call:async request=>{
        const reply = await core.call(request);
        if (request.op === "adopt" && synced) {
          const read = await core.call({op:"query",name:"one",viewer:"dev:alice",args:{},now:1000});
          between.push(read);
          assert.equal(read.ok?.denied?.code,"E_PREDICT",`no old image with implicit zero between adoption and snapshot: ${JSON.stringify(read)}`);
        }
        return reply;
      }};
    }}});
    watch = client.observe({kind:"query",name:"one"},{});
    const seen=[];
    watch.subscribe(()=>{const data=watch.getSnapshot().data;if(data)seen.push(structuredClone(data));});
    await until(()=>watch.getSnapshot().data?.id === "p");
    const after = before.replace("  at: time", "  at: time\n  likeCount: count likes by postId");
    writeFileSync(path,after);
    await until(()=>watch.getSnapshot().data?.likeCount === 1).catch(error=>{throw Error(`${error.message}; reads=${JSON.stringify(between)}; seen=${JSON.stringify(seen)}; watch=${JSON.stringify(watch.getSnapshot())}; server=${log}`)});
    assert.ok(seen.filter(row=>"likeCount" in row).every(row=>row.likeCount === 1));
    // This parent is never touched by a later application write.
    writeFileSync(path,after.replace("count likes by postId", "count likes where .selected by postId"));
    await until(()=>watch.getSnapshot().data?.likeCount === 0);
    if (synced) assert.equal(between.length,2);
    else assert.ok(seen.some(row=>row.likeCount === 1) && seen.some(row=>row.likeCount === 0),"server-run watch reruns on the parent barrier");
  });
}
