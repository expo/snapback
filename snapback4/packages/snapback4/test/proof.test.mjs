import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { cli, startDev, startServe, startStatic, startVite, deploy, rollback, testSource, stopChild, cleanup, bounded, portRange, withBrowser, fillRN, statusText, waitForFresh, selectByValue, sandboxUnavailable, logsDir, command, waitForServer } from "../dist/proof.js";
import { logged, ready } from "../dist/proof-process.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
process.env.SNAPBACK4_BIN ??= join(root, "target/debug/snapback4");
const schema = `use identity guests\nuse personas alice, bob\ntable notes:\n  title: text <=80\n  public 'shared'\nquery list():\n  return notes first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { title }\n`;
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-proof-"));
  mkdirSync(join(cwd, "snapback")); writeFileSync(join(cwd, "snapback/schema.q"), schema);
  t.after(() => rmSync(cwd, { recursive: true, force: true })); return cwd;
}
const bind = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
test("runtime port range is inclusive, validated, and never cached", () => {
  assert.equal(portRange({}), "0"); assert.equal(portRange({ PORT_LO: "29040", PORT_HI: "29049" }), "29040-29049");
  for (const env of [{ PORT_LO: "2" }, { PORT_HI: "2" }, { PORT_LO: "3", PORT_HI: "2" }, { PORT_LO: "0", PORT_HI: "2" }, { PORT_LO: "2", PORT_HI: "65536" }, { PORT_LO: "x", PORT_HI: "3" }]) assert.throws(() => portRange(env), /PORT_LO/);
});
test("native and static bind beyond an occupied port; identity and independent logs", async t => {
  const cwd = fixture(t); mkdirSync(join(cwd, "dist")); writeFileSync(join(cwd, "dist/index.html"), "<h1>owned</h1>");
  const held = createServer(); const port = await bind(held); t.after(() => held.close());
  const env = { PORT_LO: String(port), PORT_HI: String(Math.min(65535, port + 20)) };
  const dev = await startDev({ cwd, env }); let web;
  try {
    assert.ok(Number(new URL(dev.url).port) > port); assert.equal((await (await fetch(dev.url + "/dev/status")).json()).pid, dev.pid);
    web = await startStatic("dist", { cwd, env }); assert.notEqual(web.url, dev.url);
    assert.equal(await (await fetch(web.url)).text(), "<h1>owned</h1>");
    for (const log of Object.values(dev.logs)) assert.ok(log.startsWith(join(cwd, "logs")), "default logs survive temp-root harness cleanup");
    assert.match(readFileSync(dev.logs.stderr, "utf8"), /SNAPBACK4_READY/);
  } finally { await cleanup(() => web?.stop(), () => stopChild(dev)); }
});
test("exhausted range and missing export fail with bounded cleanup", async t => {
  const cwd = fixture(t), held = createServer(), port = await bind(held); t.after(() => held.close());
  await assert.rejects(startDev({ cwd, env: { PORT_LO: String(port), PORT_HI: String(port) }, timeoutMs: 5000 }), /before ready/);
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(startStatic("snapback", { cwd, timeoutMs: 5000 }), /index.html/);
});
test("static host serves wasm correctly and refuses escaped symlink assets", async t => {
  const cwd = fixture(t); mkdirSync(join(cwd, "dist")); writeFileSync(join(cwd, "dist/index.html"), "shell");
  writeFileSync(join(cwd, "dist/device.wasm"), "wasm"); writeFileSync(join(cwd, "outside.txt"), "secret");
  symlinkSync(join(cwd, "outside.txt"), join(cwd, "dist/leak.txt"));
  const web = await startStatic("dist", { cwd });
  try {
    assert.equal((await fetch(web.url + "/device.wasm")).headers.get("content-type"), "application/wasm");
    assert.equal((await fetch(web.url + "/leak.txt")).status, 403);
    assert.equal(await (await fetch(web.url + "/app/route")).text(), "shell");
    assert.equal((await fetch(web.url + "/missing.js")).status, 404);
  } finally { await web.stop(); }
});
test("saved-source deploy, preview, hot forward, rollback and fixture test never change working bytes", async t => {
  const cwd = fixture(t); mkdirSync(join(cwd, "versions")); mkdirSync(join(cwd, "fixtures"));
  const v1 = join(cwd, "versions/v1.q"), v2 = join(cwd, "versions/v2.q");
  writeFileSync(v1, schema); writeFileSync(v2, schema.replace("title: text <=80", "title: text <=80\n  color: text <=20 default 'blue'"));
  writeFileSync(join(cwd, "snapback/schema.q"), "invalid current working source");
  mkdirSync(join(cwd, "versions/v1"), { recursive: true });
  writeFileSync(join(cwd, "versions/v1/schema.q"), schema);
  writeFileSync(join(cwd, "snapback/client-compatibility.json"), JSON.stringify({ baseline: "versions/v1", since_release: 2 }));
  const one = await deploy("deploy", "versions/v1", { cwd }); assert.equal(one.code, 0);
  const preview = await cli(["deploy", "deploy", "--schema", v2, "--check"], { cwd }); assert.equal(preview.code, 0, preview.stderr);
  const serve = await startServe("deploy", { cwd });
  try {
    const identity = await (await fetch(serve.url + "/auth/config")).json(); assert.ok(identity.proof_id);
    const guest = await (await fetch(serve.url + "/auth/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const query = await (await fetch(serve.url + "/q/list", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${guest.session.token}` }, body: '{"args":{}}' })).json();
    assert.deepEqual(query.data, [], "saved file names never rename the schema's operations");
    assert.equal((await fetch(serve.url + "/dev/status")).status, 403);
    assert.equal((await deploy("deploy", v2, { cwd })).code, 0);
    assert.equal((await rollback("deploy", 1, { cwd })).code, 0);
    assert.equal((await rollback("deploy", "latest", { cwd })).code, 0);
  } finally { await serve.stop(); }
  assert.equal(readFileSync(join(cwd, "snapback/schema.q"), "utf8"), "invalid current working source");
  assert.equal(readFileSync(join(cwd, "deploy/releases/1/snapback/schema.q"), "utf8"), schema);
  assert.equal((await testSource(v1, { cwd, args: ["--fixture", "fixtures"], fixtureOnly: true })).code, 0);
  assert.equal(readFileSync(join(cwd, "snapback/schema.q"), "utf8"), "invalid current working source");
});
test("cli awaits close, separates output and returns refusal status", async t => {
  const cwd = fixture(t);
  const result = await cli(["guide", "testing"], { cwd }); assert.equal(result.code, 0); assert.match(result.stdout, /Testing/);
  const refusal = await cli(["not-a-command"], { cwd }); assert.notEqual(refusal.code, 0); assert.ok(refusal.stderr);
});
test("ANSI and blank ready lines, early exit, stalled readiness and TERM escalation", async t => {
  const cwd = fixture(t);
  const run = logged(process.execPath, ["-e", "console.log(''); console.log('\\x1b[32mREADY http://127.0.0.1:1234\\x1b[0m'); setInterval(()=>{},1000)"], { cwd });
  assert.equal(await ready(run, line => line.startsWith("READY ") ? line.slice(6) : undefined, 3000), "http://127.0.0.1:1234"); await stopChild(run.child);
  const dead = logged(process.execPath, ["-e", "process.exit(2)"], { cwd }); await assert.rejects(ready(dead, () => undefined, 3000), /before ready/);
  const stall = logged(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { cwd });
  await ready(stall, line => line === "ready" ? "ready" : undefined, 3000);
  await assert.rejects(ready(stall, () => undefined, 30), /timed out/); await stopChild(stall.child, 30); assert.equal(stall.child.signalCode, "SIGKILL");
});
test("cleanup bounds stalled actions and continues after errors", async () => {
  let later = false;
  await assert.rejects(cleanup(() => { throw Error("broken"); }, () => { later = true; }), AggregateError); assert.ok(later);
  await assert.rejects(bounded(new Promise(() => {}), 20, "stall"), /timed out/);
  await assert.rejects(waitForFresh({ count: () => new Promise(() => {}) }, null, 20), /no fresh signal/);
  await assert.rejects(stopChild({ nope: true }), /ChildProcess/);
});
test("exit sweep kills registered child, not a neighboring child", async t => {
  const cwd = fixture(t), pidFile = join(cwd, "child.pid");
  const helper = fileURLToPath(new URL("../dist/proof-process.js", import.meta.url));
  const script = `import {logged, ready} from ${JSON.stringify(helper)}; import {writeFileSync} from 'node:fs'; const run=logged(process.execPath,['-e',"console.log('ready'); setInterval(()=>{},1000)"], {cwd:${JSON.stringify(cwd)}}); await ready(run,l=>l==='ready'?'ok':undefined,5000); writeFileSync(${JSON.stringify(pidFile)}, String(run.child.pid)); process.exit(0);`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" }); await new Promise(resolve => parent.once("close", resolve));
  const pid = Number(readFileSync(pidFile, "utf8"));
  for (let tries = 0; tries < 100; tries++) {
    try { process.kill(pid, 0); if (process.platform === "linux" && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) return; }
    catch { return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`child ${pid} survived proof exit`);
});
test("Vite uses the project's config and bound identity", async t => {
  const cwd = fixture(t); writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
  writeFileSync(join(cwd, "index.html"), "<h1>vite-owned</h1>");
  writeFileSync(join(cwd, "vite.config.mjs"), "export default { server: { port: 49123 } };");
  const web = await startVite(cwd, { cwd }); try { assert.match(await (await fetch(web.url)).text(), /vite-owned/); } finally { await web.stop(); }
});
test("browser helpers use fresh text, stable values and RN keystrokes", async t => {
  const cwd = fixture(t);
  assert.ok(sandboxUnavailable("Failed to move to new namespace: Operation not permitted")); assert.ok(!sandboxUnavailable("Executable does not exist"));
  await withBrowser({ executablePath: process.env.CHROME, cwd }, async context => {
    const page = await context.newPage();
    await page.setContent('<p role="status">old</p><input aria-label="Task"><select aria-label="Choice"><option value="a">A</option><option value="b">B</option></select>');
    const status = statusText(page, /old|fresh/);
    await page.evaluate(() => setTimeout(() => document.querySelector("p").textContent = "fresh", 30));
    assert.equal(await waitForFresh(status, "old"), "fresh");
    await assert.rejects(waitForFresh(status, "fresh", 30), /no fresh signal/);
    await fillRN(page.getByLabel("Task"), "Hello"); assert.equal(await page.getByLabel("Task").inputValue(), "Hello");
    await selectByValue(page.getByLabel("Choice"), "b"); assert.equal(await page.getByLabel("Choice").inputValue(), "b");
  });
});

test("SIGKILLed driver closes frontend liveness and sweeps its whole private group", async t => {
  const cwd = fixture(t); mkdirSync(join(cwd, "dist")); writeFileSync(join(cwd, "dist/index.html"), "owned");
  const pidFile = join(cwd, "frontend.pid");
  const module = fileURLToPath(new URL("../dist/proof.js", import.meta.url));
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `import {startStatic} from ${JSON.stringify(module)}; import {writeFileSync} from 'node:fs'; const host=await startStatic('dist',{cwd:${JSON.stringify(cwd)}}); writeFileSync(${JSON.stringify(pidFile)},String(host.pid));`], { stdio: "ignore" });
  t.after(() => parent.kill("SIGKILL"));
  await bounded((async () => { while (true) { try { readFileSync(pidFile); return; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); } })(), 5000, "frontend start");
  const pid = Number(readFileSync(pidFile, "utf8"));
  parent.kill("SIGKILL"); await new Promise(resolve => parent.once("close", resolve));
  // Only inspect. Signals are dispatched by the live keeper to its own group.
  const { execFileSync } = await import("node:child_process");
  await bounded((async () => {
    while (true) {
      const rows = execFileSync("ps", ["-eo", "pgid=,stat="], { encoding: "utf8", timeout: 2000 });
      const living = rows.trim().split("\n").some(row => { const [group, state] = row.trim().split(/\s+/); return Number(group) === pid && !state.startsWith("Z"); });
      if (!living) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  })(), 5000, "frontend group drain");
});

test("saved schemas typecheck server companions against private candidate API without replacing working types", async t => {
  const cwd = fixture(t);
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
  writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
  const companion = args => `import { api } from './generated/api.ts'; import type { ArgsOf } from 'snapback4/contract'; export const supplied: ArgsOf<typeof api.add> = ${args}; export default {};\n`;
  writeFileSync(join(cwd, "snapback/server.ts"), companion('{ title: "working" }'));
  const checked = await cli(["check"], { cwd }); assert.equal(checked.code, 0, checked.stderr);
  const before = readFileSync(join(cwd, "snapback/generated/api.ts"), "utf8");
  const selected = join(cwd, "selected.q");
  writeFileSync(selected, schema.replace('mutation add(title: text <=80):\n  return insert notes { title }', "mutation add(amount: int):\n  return insert notes { title: 'saved' }"));
  const refused = await cli(["deploy", "deploy", "--schema", selected], { cwd });
  assert.notEqual(refused.code, 0); assert.match(refused.stderr, /title|amount/);
  assert.equal(readFileSync(join(cwd, "snapback/generated/api.ts"), "utf8"), before);
  writeFileSync(join(cwd, "snapback/server.ts"), companion('{ amount: 1 }'));
  const accepted = await deploy("deploy", selected, { cwd }); assert.equal(accepted.code, 0);
  assert.match(readFileSync(join(cwd, "deploy/releases/1/snapback/generated/api.ts"), "utf8"), /amount/);
  assert.equal(readFileSync(join(cwd, "snapback/generated/api.ts"), "utf8"), before);
  assert.equal(readFileSync(join(cwd, "snapback/schema.q"), "utf8"), schema);
});

test("ready PID and served marker mismatches refuse instead of adopting another identity", { skip: process.platform === "win32" }, async t => {
  const cwd = fixture(t), original = process.env.SNAPBACK4_BIN;
  try {
    for (const wrong of ["pid", "marker"]) {
      const binary = join(cwd, `fake-${wrong}.mjs`);
      const script = `#!${process.execPath}\nimport {createServer} from 'node:http'; const server=createServer((req,res)=>{ res.setHeader('content-type','application/json'); res.end(JSON.stringify({pid:process.pid, proof_id:${wrong === "marker" ? "'wrong-marker'" : "process.env.SNAPBACK4_PROOF_ID"}})); }); server.listen(0,'127.0.0.1',()=>console.error('SNAPBACK4_READY verb=dev generation=1 url=http://127.0.0.1:'+server.address().port+' pid='+${wrong === "pid" ? "(process.pid+1)" : "process.pid"}));`;
      writeFileSync(binary, script, { mode: 0o755 });
      process.env.SNAPBACK4_BIN = binary;
      await assert.rejects(startDev({ cwd, timeoutMs: 5000 }), /identity mismatch/);
    }
  } finally {
    if (original === undefined) delete process.env.SNAPBACK4_BIN; else process.env.SNAPBACK4_BIN = original;
  }
});


test("secret stdout stays in memory; token CLI automatically selects secret capture", async t => {
  const cwd = fixture(t);
  assert.equal(logsDir({cwd}), join(cwd, "logs"));
  const result = await command(process.execPath, ["-e", "console.log('private bearer'); console.error('diagnostic')"], {cwd, secret:true});
  assert.equal(result.stdout, "private bearer\n");
  assert.equal(readFileSync(result.logs.stdout, "utf8"), "");
  assert.equal(readFileSync(result.logs.stderr, "utf8"), "diagnostic\n");
  const original=process.env.SNAPBACK4_BIN;
  const fake=join(cwd,'token.mjs');
  writeFileSync(fake, `#!${process.execPath}\nconsole.log('minted bearer')`, {mode:0o755});
  process.env.SNAPBACK4_BIN=fake;
  try {
    const token = await cli(['token'], {cwd});
    assert.equal(token.code,0);assert.equal(token.stdout,'minted bearer\n');
    assert.equal(readFileSync(token.logs.stdout,'utf8'),'');
  } finally { if(original===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=original; }
});
test("startDev args preserve memory isolation unless a store is explicit", async t => {
  const cwd=fixture(t);
  for (const args of [['--port','0'], []]) {
    const host=await startDev({cwd,args});
    try {
      const list=await (await fetch(host.url+'/q/list',{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:'{"args":{}}'})).json();
      assert.deepEqual(list.data,[]);
      await fetch(host.url+'/seed',{method:'POST',headers:{'content-type':'application/json'},body:'[{"table":"notes","row":{"id":"one","title":"seed"}}]'});
    } finally {await host.stop();}
  }
});
test("waitForServer waits for authoritative projection and diagnoses unchanged truth", async () => {
  let reads=0;
  assert.equal(await waitForServer(async()=>++reads, value=>value===3, {timeoutMs:1000}),3);
  await assert.rejects(waitForServer(async()=>({pending:true}),()=>false,{timeoutMs:50,label:'committed row'}), /committed row.*last=.*pending/);
  let calls=0;
  await assert.rejects(waitForServer(()=>++calls===1?Promise.resolve('last truth'):new Promise(()=>{}),()=>false,{timeoutMs:50,label:'stalled read'}),/stalled read.*last="last truth"/);
});


test("proof browser navigation arms witness before application registration", async t => {
  const cwd=fixture(t);mkdirSync(join(cwd,'dist'));
  writeFileSync(join(cwd,'dist/index.html'), '<p></p><script>document.querySelector("p").textContent=new URLSearchParams(location.search).get("witness")</script>');
  const host=await startStatic('dist',{cwd});
  try {
    await withBrowser({cwd,executablePath:process.env.CHROME},async context=>{
      const page=await context.newPage();await page.goto(host.url+'/?api=kept');
      assert.equal(await page.locator('p').textContent(),'web');
      assert.equal(new URL(page.url()).searchParams.get('api'),'kept');
    });
  } finally {await host.stop();}
});


test("--no-memory is consumed by the kit and retains dev rows across restarts", async t => {
  const cwd=fixture(t),options={cwd,args:['--no-memory']};
  let host=await startDev(options);
  const seed=await fetch(host.url+'/seed',{method:'POST',headers:{'content-type':'application/json'},body:'[{"table":"notes","row":{"id":"kept","title":"Persistent"}}]'});
  assert.equal(seed.status,200);await host.stop();host=await startDev(options);
  try {
    const read=await (await fetch(host.url+'/q/list',{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:'{"args":{}}'})).json();
    assert.equal(read.data[0].title,'Persistent');
  } finally {await host.stop();}
  assert.throws(()=>startDev({cwd,args:['--memory','--no-memory']}),/conflicts/);
});
test("proof witness injection survives HTTP redirect destinations", async t => {
  const cwd=fixture(t),server=httpServer((req,res)=>{
    if(req.url.startsWith('/start')){res.writeHead(302,{location:'/landing?api=kept'});res.end();}
    else {res.setHeader('content-type','text/html');res.end('<script>window.sampled=new URLSearchParams(location.search).get("witness")</script>');}
  });
  const port=await bind(server);
  try {await withBrowser({cwd,executablePath:process.env.CHROME},async context=>{
    const page=await context.newPage();await page.goto('http://127.0.0.1:'+port+'/start');
    assert.equal(await page.evaluate(()=>window.sampled),'web');
    assert.equal(new URL(page.url()).searchParams.get('api'),'kept');
  });}finally{await new Promise(resolve=>server.close(resolve));}
});


test("secret capture releases its pipe when an exited tool leaves a descendant holding stdout", {
  skip: process.platform === "win32" && "The pipe-holder exit witness uses portable Unix ps (Linux and Darwin)",
}, async t => {
  const cwd=fixture(t),module=fileURLToPath(new URL('../dist/proof.js',import.meta.url));
  const script=join(cwd,'driver.mjs'),marker=join(cwd,'desc-ready');
  writeFileSync(script, `import {command} from ${JSON.stringify(module)};
try {await command(process.execPath,['-e',\`const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],{stdio:['ignore',1,2]});require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:child.pid}));process.exit(0)\`],{cwd:${JSON.stringify(cwd)},secret:true,timeoutMs:1000});process.exitCode=1;}
catch(error){if(!/timed out/.test(error.message))throw error;}`);
  const child=spawn(process.execPath,[script],{stdio:'ignore'});
  let holder;
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    // The regression deliberately outlives the driver. Observe its own finite
    // lifetime before ending the file; never signal a retained descendant PID.
    if(holder) await bounded((async()=>{
      while(true){
        let state;
        try {state=execFileSync('ps',['-p',String(holder),'-o','stat='],{encoding:'utf8',timeout:2000}).trim();}
        catch(error){if(error.status===1 && !String(error.stdout).trim())return;throw error;}
        if(state.startsWith('Z'))return;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    })(),10000,'pipe holder exit');
  });
  await bounded((async()=>{while(!holder){try{holder=JSON.parse(readFileSync(marker,'utf8')).pid;}catch(error){if(error.code!=='ENOENT')throw error;}if(!holder)await new Promise(resolve=>setTimeout(resolve,20));}})(),5000,'pipe holder spawned');
  assert.equal(await bounded(closed,5000,'secret driver exit'),0);
});
