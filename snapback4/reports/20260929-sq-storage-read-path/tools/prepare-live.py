"""Use PF's real replay adapter, keeping exact mutation mapping and frozen log.
Insert immediate probes BEFORE verification; keep the original verifier.
"""
import pathlib,shutil
root=pathlib.Path.cwd();base=root/'target/sq';live=base/'live'
if live.exists():raise RuntimeError('live exists; preserve it before preparing another replay')
shutil.copytree(base/'replay',live,symlinks=True,ignore=shutil.ignore_patterns('.snapback4','evidence'))
(live/'evidence').mkdir();(live/'node_modules/.bin/snapback4').unlink();(live/'node_modules/.bin/snapback4').symlink_to(base/'snapback4-diagnostic')
src=(root/'snapback4/reports/20260928-pf-scale-curves/tools/replay-adapter.mjs').read_text()
src=src.replace('const clients = new Map();', 'const { defaultFetch } = await import("file://" + process.env.SQ_REPO + "/snapback4/packages/snapback4/dist/node-fetch.js");\nlet sqCapture = [];\nconst sqFetch = async (input, init) => { const r = await defaultFetch(input, init); if (String(input).includes("/q/")) sqCapture.push({op:String(input).split("/q/")[1],timing:r.headers.get("server-timing")}); return r; };\nconst clients = new Map();')
src=src.replace('createClient({ url, token: state.users[who].token })', 'createClient({ url, token: state.users[who].token, fetch: sqFetch })')
src=src.replace('      let result;','      await sqProbe(stage);\n      let result;')
src=src.replace('      execFileSync("python3", ["../snapshot.py", process.env.REPLAY_BACKEND_DIR, stage.replace("%", "pct"), directory], { stdio: "inherit" });\n      if (stage === "50%") break;','      sqSnapshot(stage);')
src=src.replace('if (false && path.basename(log) === "scale.log") {','if (path.basename(log) === "scale.log") {\n    save();\n    await sqProbe("full");')
src=src.replace('    excludedSeconds += Date.now() / 1000 - began;\n  }','    excludedSeconds += Date.now() / 1000 - began;\n    sqSnapshot("full");\n  }')
# Probe inline with existing clients, before verification/auth/warmup. The
# hook timestamp follows prefix hashing/state save; receipt settlement is separate.
src+='''
async function sqProbe(stage) {
  const at=Date.now();
  await sqInline(stage, at);
  fs.copyFileSync(stateFile, "state.private.json");
  const base=path.resolve("..");
  const tool=process.env.SQ_CURVE;
  for (const [suffix,rounds,warmups] of [["warm","9","3"]]) {
    execFileSync("node", [tool,stage+"-live-"+suffix], {cwd:process.env.SQ_REPO,stdio:"inherit",env:{...process.env,SQ_ROOT:base,SQ_STAGES:JSON.stringify([["live",49561]]),SQ_ROUNDS:rounds,SQ_WARMUPS:warmups,SQ_LOGIN:"0",SQ_SKIP_DEEP:"1"}});
  }
  fs.writeFileSync(path.join(base,stage+"-queues.json"), execFileSync("python3",[process.env.SQ_QUEUES,path.resolve(".snapback4/store.sqlite")]));
  fs.writeFileSync(path.join(base,stage+"-live-offset.json"),JSON.stringify({hookEnteredAt:at,end:Date.now()}));
}
function sqSnapshot(stage) {
  execFileSync("python3",[process.env.SQ_SNAPSHOT,path.resolve("."),"replayed-"+stage.replace("%","pct"),directory],{stdio:"inherit"});
}

async function sqInline(stage, at) {
  const {loadavg,cpus,freemem}=await import("node:os");
  const host=()=>({at:new Date().toISOString(),loadavg:loadavg(),cpus:cpus().length,freeBytes:freemem()});
  const batch={round:0,stage:"live",host:host(),probes:{}};
  for(const [name,who,op,args] of [
    ["busyHistory","u0001","chat.history",{conversation:idFrom("g0001"),c:null}],
    ["following500","u0500","home",{c:null}],
    ["following5","u0005","home",{c:null}],
    ["celebrityFollower","u0901","home",{c:null}],
    ["search100","u0500","chat.searchMessages",{q:"coffee",conversation:null,c:null}],
    ["insights","u0500","insights.summary",{}],
    ["trending","u0500","insights.trending",{c:null}]]) {
    const times=[],timestamps=[],completeness=[];let last;sqCapture=[];
    for(let i=0;i<10;i++){timestamps.push(Date.now());const start=performance.now();last=await read(client(who),op,args);times.push(performance.now()-start);completeness.push(last.complete);}
    const sorted=[...times].sort((a,b)=>a-b);
    batch.probes[name]={p50:sorted[4],p95:sorted[9],max:sorted[9],times,timestamps,serverTiming:[...sqCapture],meter:last.meter,completeness,complete:last.complete};
  }
  fs.writeFileSync(path.resolve("..",stage+"-live-immediate-curve.json"),JSON.stringify({tag:stage+"-live-immediate",hookEnteredAt:at,method:"same process and existing replay clients; no warmup, verification or authentication before first read",rounds:[batch]},null,2));
}

'''
(live/'scripts/replay.mjs').write_text(src)
