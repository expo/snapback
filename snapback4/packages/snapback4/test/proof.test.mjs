import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, cpSync, chmodSync } from "node:fs";
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
test("process-only proof imports leave Playwright and SQLite unloaded", async t => {
  const cwd = fixture(t);
  const result = await command(process.execPath, ["--input-type=module", "-e", `
    import { createRequire } from 'node:module';
    import assert from 'node:assert/strict';
    await import(${JSON.stringify(new URL('../dist/proof.js', import.meta.url).href)});
    const require = createRequire(import.meta.url);
    assert.ok(!Object.keys(require.cache).some(path => path.includes('playwright-core')));
    assert.ok(!process.moduleLoadList.some(name => name.includes('sqlite')));
    const Module = require('node:module'), load = Module._load;
    const {registeredLocator} = await import(${JSON.stringify(new URL('../dist/proof-text.js', import.meta.url).href)});
    let attempts = 0;
    Module._load = function(id, ...args) {
      if (id === 'playwright-core' && attempts++ === 0) throw Error('transient peer failure');
      return load.call(this, id, ...args);
    };
    try {
      assert.throws(() => registeredLocator({count: async () => 0}), /transient peer failure/);
      assert.equal(await registeredLocator({count: async () => 0}).count(), 0);
      assert.equal(attempts, 2, 'failed require must not latch successful registration');
    } finally { Module._load = load; }
  `], {cwd});
  assert.equal(result.code, 0, result.stderr);
});
test("native proof commands retain helper environment, argument boundaries and secret logs", {skip:process.platform === "win32" ? "executable shebang fixture requires Unix" : false}, async t => {
  const cwd = fixture(t), binary = join(cwd, "native.mjs");
  writeFileSync(binary, `#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2), parent:process.ppid, helpers:Object.fromEntries(['ACQUIRE','UPGRADE','WEB'].map(key=>[key,process.env['SNAPBACK4_'+key+'_HELPER']])),supervisor:process.env.SNAPBACK4_SUPERVISOR_PID}));process.exitCode=7;\n`);
  chmodSync(binary, 0o700);
  const result = await cli(["token", "--service", "literal space; $text"], {cwd, env:{SNAPBACK4_BIN:binary,SNAPBACK4_WEB_HELPER:"wrong"}});
  assert.equal(result.code, 7, result.stderr);
  const reply = JSON.parse(result.stdout);
  assert.deepEqual(reply.args, ["token", "--service", "literal space; $text"]);
  assert.equal(reply.supervisor, String(reply.parent));
  for (const [key, file] of [["ACQUIRE", "witness-acquire"], ["UPGRADE", "upgrade"], ["WEB", "witness-web"]]) {
    assert.equal(reply.helpers[key], fileURLToPath(new URL(`../bin/${file}.js`, import.meta.url)));
  }
  assert.match(readFileSync(result.logs.stdout, "utf8"), /^stdout withheld: secret command/);
  await assert.rejects(cli(["token"],{cwd,timeoutMs:0,env:{SNAPBACK4_BIN:binary}}),/proof timeout must be positive and finite/);
  // A changed invocation resolves its binary afresh; no result or resolver cache.
  const second = join(cwd, "second.mjs");
  writeFileSync(second, "#!/usr/bin/env node\nconsole.log('second');\n"); chmodSync(second, 0o700);
  assert.equal((await cli(["data"], {cwd,env:{SNAPBACK4_BIN:second}})).stdout.trim(), "second");
  assert.equal((await cli(["token"], {cwd,env:{SNAPBACK4_BIN:"second.mjs"}})).stdout.trim(), "second", "relative override resolves inside command cwd");
  mkdirSync(join(cwd,"real/child"),{recursive:true});
  const canonical=join(cwd,"real/second.mjs");writeFileSync(canonical,"#!/usr/bin/env node\nconsole.log('canonical');\n");chmodSync(canonical,0o700);
  const alias=join(cwd,"alias");symlinkSync(join(cwd,"real/child"),alias,"dir");
  assert.equal((await cli(["token"], {cwd:alias,env:{SNAPBACK4_BIN:"../second.mjs"}})).stdout.trim(), "canonical", "resolve ../ from the child's canonical cwd");
  const failed = join(cwd, "not-executable");writeFileSync(failed,"not executable",{mode:0o600});
  const shim = await command(process.execPath,[fileURLToPath(new URL('../bin/snapback4.js',import.meta.url)),"token"],{cwd,env:{SNAPBACK4_BIN:failed},secret:true});
  const native = await cli(["token"],{cwd,env:{SNAPBACK4_BIN:failed}});
  assert.equal(native.code,shim.code);
  assert.equal(native.signal,shim.signal);
  const message=text=>text.match(/Error: spawn [^\n]+/)?.[0];
  assert.ok(message(native.stderr));assert.equal(message(native.stderr),message(shim.stderr));
  await assert.rejects(command(failed,[],{cwd}),error=>{
    assert.match(error.message,/EACCES/);assert.deepEqual(Object.keys(error),[]);return true;
  });
  const delayed=join(cwd,"delay.mjs");
  writeFileSync(delayed,`import {setTimeout as sleep} from 'node:timers/promises';
    if (process.argv[1]?.endsWith('/proof-command.js') && process.argv[2] === ${JSON.stringify(failed)}) await sleep(600);
    if (process.argv[1]?.endsWith('/bin/snapback4.js')) await sleep(900);
  `);
  await assert.rejects(cli(["token"],{cwd,timeoutMs:1200,env:{SNAPBACK4_BIN:failed,NODE_OPTIONS:`--import=${delayed}`}}),/proof cli close timed out after 1200 ms/);
});
test("runtime port range is inclusive, validated, and never cached", () => {
  assert.equal(portRange({}), "0"); assert.equal(portRange({ PORT_LO: "29040", PORT_HI: "29049" }), "29040-29049");
  for (const env of [{ PORT_LO: "2" }, { PORT_HI: "2" }, { PORT_LO: "3", PORT_HI: "2" }, { PORT_LO: "0", PORT_HI: "2" }, { PORT_LO: "2", PORT_HI: "65536" }, { PORT_LO: "x", PORT_HI: "3" }]) assert.throws(() => portRange(env), /PORT_LO/);
});
test("proof hosts select the binary from their explicit environment", async t => {
  const cwd = fixture(t), binary = join(cwd, "selected-binary");
  writeFileSync(binary, `#!${process.execPath}\nconsole.error('selected proof environment binary');process.exit(1);\n`, { mode: 0o755 });
  const options = { cwd, env: { SNAPBACK4_BIN: binary }, timeoutMs: 5000 };
  for (const start of [() => startDev(options), () => startServe("unused-deployment", options)]) {
    await assert.rejects(start(), /selected proof environment binary/);
  }
});
test("proof host startup rejects an unspawnable binary before the readiness deadline", { skip: process.platform === "win32" }, async t => {
  const cwd=fixture(t),binary=join(cwd,"not-executable");writeFileSync(binary,"#!/bin/sh\nexit 0\n",{mode:0o644});
  await assert.rejects(bounded(startDev({cwd,env:{...process.env,SNAPBACK4_BIN:binary},timeoutMs:500}),2000,"unspawnable proof host"),/EACCES|permission denied/i);
});
test("native and static bind beyond an occupied port; identity and independent logs", async t => {
  const cwd = fixture(t); mkdirSync(join(cwd, "dist")); writeFileSync(join(cwd, "dist/index.html"), "<h1>owned</h1>");
  const held = createServer(); const port = await bind(held); t.after(() => held.close());
  const env = { PORT_LO: String(port), PORT_HI: String(Math.min(65535, port + 20)) };
  const dev = await startDev({ cwd, env }); let web;
  try {
    assert.deepEqual(dev.personas, ["alice", "bob"]);
    assert.ok(Number(new URL(dev.url).port) > port); assert.equal((await (await fetch(dev.url + "/dev/status")).json()).pid, dev.pid);
    const before = await dev.now();
    const advanced = await fetch(dev.url + "/dev/clock/advance", { method: "POST", body: JSON.stringify({duration:"2h"}) }).then(r=>r.json());
    assert.ok(advanced.now >= before + 7_200_000); assert.ok(Math.abs(advanced.skewMs - 7_200_000) < 1000);
    assert.ok(await dev.now() >= advanced.now);
    const reset = await fetch(dev.url + "/dev/reset", { method: "POST", body: "{}" }).then(r=>r.json());
    assert.ok(reset.now >= advanced.now); assert.ok(reset.skewMs >= 7_199_000);
    assert.ok(await dev.now() >= reset.now);
    web = await startStatic("dist", { cwd, env }); assert.notEqual(web.url, dev.url);
    assert.equal(await (await fetch(web.url)).text(), "<h1>owned</h1>");
    for (const log of Object.values(dev.logs)) assert.ok(log.startsWith(join(cwd, "logs")), "default logs survive temp-root harness cleanup");
    assert.match(readFileSync(dev.logs.stderr, "utf8"), /SNAPBACK4_READY/);
  } finally { await cleanup(() => web?.stop(), () => stopChild(dev)); }
});
test("exhausted range and missing export fail with bounded cleanup", async t => {
  const cwd = fixture(t), held = createServer(), port = await bind(held); t.after(() => held.close());
  await assert.rejects(startDev({ cwd, env: { PORT_LO: String(port), PORT_HI: String(port) }, timeoutMs: 5000 }), /before ready/);
  await assert.rejects(startStatic("dist", { cwd, timeoutMs: 5000 }), /startStatic: .*dist does not exist; frontend proofs build their own dist/);
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

test("frontend stop waits for keeper-backed descendant cleanup", { skip: process.platform === "win32", timeout: 15000 }, async t => {
  const cwd=fixture(t),pidFile=join(cwd,"descendant.pid");
  writeFileSync(join(cwd,"descendant.cjs"),`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  writeFileSync(join(cwd,"keeper.cjs"),`process.stdin.resume();process.stdin.once('end',()=>setTimeout(()=>process.kill(0,'SIGKILL'),250));`);
  writeFileSync(join(cwd,"driver.cjs"),`const {spawn}=require('node:child_process');
const guard=spawn(process.execPath,[${JSON.stringify(join(cwd,"keeper.cjs"))}],{stdio:['pipe','ignore','ignore']});
spawn(process.execPath,[${JSON.stringify(join(cwd,"descendant.cjs"))}],{stdio:'ignore'});
process.once('exit',()=>guard.stdin.destroy());process.once('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`);
  const run=logged(process.execPath,[join(cwd,"driver.cjs")],{cwd,detached:true,livenessPipe:true});
  t.after(()=>{try{process.kill(-run.child.pid,"SIGKILL");}catch{}});
  await bounded((async()=>{while(true){try{readFileSync(pidFile);return;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}})(),5000,"descendant start");
  const started=performance.now();await stopChild(run.child,1000);
  assert.ok(performance.now()-started>=150,"stop waits for the keeper's delayed group sweep");
  const rows=execFileSync("ps",["-eo","pgid=,stat="],{encoding:"utf8",timeout:2000});
  assert.equal(rows.trim().split("\n").some(row=>{const [group,state]=row.trim().split(/\s+/);return Number(group)===run.child.pid&&!state.startsWith("Z");}),false);
});

test("frontend startup cleanup refuses when its keeper is lost with a live descendant", { skip: process.platform === "win32", timeout: 15000 }, async t => {
  const cwd=fixture(t),pidFile=join(cwd,"orphan.pid");
  writeFileSync(join(cwd,"orphan.cjs"),`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  writeFileSync(join(cwd,"lost-keeper.cjs"),`const {spawn}=require('node:child_process');spawn(process.execPath,[${JSON.stringify(join(cwd,"orphan.cjs"))}],{stdio:'ignore'});setTimeout(()=>process.exit(1),25);`);
  const run=logged(process.execPath,[join(cwd,"lost-keeper.cjs")],{cwd,detached:true,livenessPipe:true});
  t.after(()=>{try{process.kill(-run.child.pid,"SIGKILL");}catch{}});
  await bounded((async()=>{while(true){try{readFileSync(pidFile);return;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}})(),5000,"orphan start");
  await assert.rejects((async()=>{
    try { await ready(run,()=>undefined,1000); }
    catch (error) { await stopChild(run.child,250); throw error; }
  })(),/proof process-group cleanup timed out after 5000 ms/);
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
  assert.match(readFileSync(result.logs.stdout, "utf8"), /^stdout withheld: secret command/);
  assert.doesNotMatch(readFileSync(result.logs.stdout, "utf8"), /private bearer/);
  assert.equal(readFileSync(result.logs.stderr, "utf8"), "diagnostic\n");
  const original=process.env.SNAPBACK4_BIN;
  const fake=join(cwd,'token.mjs');
  writeFileSync(fake, `#!${process.execPath}\nconsole.log('minted bearer')`, {mode:0o755});
  process.env.SNAPBACK4_BIN=fake;
  try {
    const token = await cli(['token'], {cwd});
    assert.equal(token.code,0);assert.equal(token.stdout,'minted bearer\n');
    assert.match(readFileSync(token.logs.stdout,'utf8'),/^stdout withheld: secret command/);
    assert.doesNotMatch(readFileSync(token.logs.stdout,'utf8'),/minted bearer/);
  } finally { if(original===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=original; }
});
test("startDev explicit --memory preserves isolation with custom arguments", async t => {
  const cwd=fixture(t);
  for (const args of [['--port','0','--memory'], ['--memory']]) {
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


// Correctness waits own their timers and observe test cancellation. A race with
// an unbounded polling promise leaves that promise alive after a failed assertion.
async function cleanupCondition(t, probe, label, timeoutMs = 120_000) {
  const end = performance.now() + timeoutMs;
  for (;;) {
    t.signal.throwIfAborted();
    if (await probe()) return;
    assert.ok(performance.now() < end, `${label}: condition not reached`);
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(t.signal.reason); };
      const timer = setTimeout(() => { t.signal.removeEventListener('abort', abort); resolve(); }, 25);
      t.signal.addEventListener('abort', abort, {once:true});
      if (t.signal.aborted) abort();
    });
  }
}
test("proof command cleanup owns npm descendants and caller death", {
  skip: process.platform === "win32" && "private process-group custody requires Unix",
  timeout: 300000,
}, async t => {
  const cwd=fixture(t),module=fileURLToPath(new URL('../dist/proof.js',import.meta.url));
  const helper=join(cwd,'hold.mjs');
  writeFileSync(helper, `import{spawn}from'node:child_process';import{writeFileSync,existsSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));setInterval(()=>{if(existsSync('finish'))process.exit(7);},25);`);
  writeFileSync(join(cwd,'package.json'),JSON.stringify({private:true,type:'module',scripts:{hold:'node hold.mjs npm-pids.json'}}));
  const markerPids = marker => {try{return JSON.parse(readFileSync(join(cwd,marker),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return undefined;}};
  const pidsGone=async marker=>cleanupCondition(t, async()=>{
    const pids=markerPids(marker);if(!pids)return false;
    const alive=pids.filter(pid=>{try{return !execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','pipe']}).trim().startsWith('Z');}catch(error){if(error.status===1&&!String(error.stdout).trim())return false;throw error;}});
    return !alive.length;
  },`process tree ${marker} cleanup`);
  // Finish only after npm has actually spawned its descendants; CPU scheduling
  // cannot cause the command deadline to win before the marker is written.
  const running=command('npm',['run','--silent','hold'],{cwd,timeoutMs:180_000,stopTimeoutMs:30_000});
  void running.catch(()=>{});
  await cleanupCondition(t,()=>markerPids('npm-pids.json')?.length===2,'npm descendants started');
  writeFileSync(join(cwd,'finish'),'yes');
  assert.equal((await running).code,7);
  await pidsGone('npm-pids.json');
  // Retain the distinct timeout cleanup control without making npm startup a clock race.
  await assert.rejects(command(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,timeoutMs:200,stopTimeoutMs:30_000}),/timed out/);
  const driver=join(cwd,'caller.mjs');
  writeFileSync(driver,`import{command}from ${JSON.stringify(module)};command(process.execPath,['hold.mjs','caller-pids.json'],{cwd:${JSON.stringify(cwd)},timeoutMs:180000});setInterval(()=>{},1000);`);
  // The second command must remain alive until its caller dies.
  rmSync(join(cwd,'finish'));
  const caller=spawn(process.execPath,[driver],{stdio:'ignore'});t.after(()=>{if(caller.exitCode===null&&caller.signalCode===null)caller.kill('SIGKILL');});
  await cleanupCondition(t,()=>markerPids('caller-pids.json')?.length===2,'caller descendants started');
  const closed=new Promise(resolve=>caller.once('close',resolve));caller.kill('SIGKILL');await closed;
  await pidsGone('caller-pids.json');
});

test("process-group cleanup deadline stops polling after refusal", { skip: process.platform === "win32" }, async t => {
  const cwd=fixture(t),nativeKill=process.kill.bind(process);let clock=0,probes=0;
  t.mock.method(performance,"now",()=>clock+=6000);
  t.mock.method(process,"kill",(pid,signal)=>{if(pid<0){probes++;return true;}return nativeKill(pid,signal);});
  await assert.rejects(command(process.execPath,["-e",""],{cwd,timeoutMs:1000}),/process-group cleanup timed out/);
  const settled=probes;await new Promise(resolve=>setTimeout(resolve,50));assert.equal(probes,settled,"deadline leaves no polling timer behind");
});

test('KIT4 missing static output names the app build script', async t => {
  const cwd=mkdtempSync(join(tmpdir(),'kit4-build-script-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  for (const script of ['build:web','build']) {
    writeFileSync(join(cwd,'package.json'),JSON.stringify({scripts:{[script]:'builder'}}));
    await assert.rejects(startStatic('dist',{cwd}), error=>{assert.ok(error.message.includes(`run", "${script}"`),error.message);return true;});
  }
});

test('KIT4 missing browser peer refuses before logs or the proof callback', async t => {
  const cwd=mkdtempSync(join(tmpdir(),'kit4-missing-peer-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  cpSync(join(root,'packages/snapback4/dist'),join(cwd,'dist'),{recursive:true});
  writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
  writeFileSync(join(cwd,'peer.mjs'),`
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {withBrowser} from './dist/proof.js';
let called=false;
await assert.rejects(withBrowser({cwd:process.cwd()},async()=>{called=true;}),/E_PROOF_BROWSER: withBrowser requires playwright-core.*npm install/);
assert.equal(called,false);assert.equal(existsSync('logs'),false);
`);
  const result=await command(process.execPath,['peer.mjs'],{cwd,logsDir:join(cwd,'driver-logs'),env:{NODE_PATH:''}});
  assert.equal(result.code,0,result.stdout+result.stderr);
});

test("serve stop waits for delayed worker cleanup before resolving and is replayable", async t => {
  const cwd=fixture(t), worker=join(cwd,"snapback/worker.mjs");
  writeFileSync(worker, `import {writeFileSync} from 'node:fs'; const root=${JSON.stringify(cwd)}; process.on('SIGTERM',()=>setTimeout(()=>{writeFileSync(root+'/worker-released','yes');process.exit(0);},700)); writeFileSync(root+'/worker-ready','yes');setInterval(()=>{},1000);`);
  assert.equal((await deploy("deploy","snapback",{cwd})).code,0);
  const host=await startServe("deploy",{cwd,args:["--worker",worker]});
  try {
    for(let n=0;n<200;n++){try{readFileSync(join(cwd,"worker-ready"));break;}catch{await new Promise(r=>setTimeout(r,25));}}
    assert.equal(readFileSync(join(cwd,"worker-ready"),"utf8"),"yes");
    await Promise.all([host.stop(),host.stop()]);
    assert.equal(readFileSync(join(cwd,"worker-released"),"utf8"),"yes");
    const barrier=await cli(["serve","deploy","--wait-stopped"],{cwd});assert.equal(barrier.code,0,barrier.stderr);
    const switched=await rollback("deploy",1,{cwd});assert.equal(switched.code,0,switched.stderr);
    await host.stop();
  } finally {await host.stop();}
});

// The kernel can transiently deny a signal-0 group probe during keeper exit.
// A denial is presence, and only a subsequent ESRCH proves cleanup complete.
test("process-group cleanup waits through a transient EPERM", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-proof-eperm-"));
  const originalKill = process.kill;
  const run = logged(process.execPath, ["-e", ""], { cwd, processGroup: true });
  let probes = 0;
  process.kill = function (pid, signal) {
    if (pid === -run.child.pid && signal === 0 && ++probes === 1)
      throw Object.assign(Error("retiring process group"), { code: "EPERM" });
    return originalKill.call(process, pid, signal);
  };
  try { await run.closed; assert.ok(probes >= 2); }
  finally { process.kill = originalKill; await stopChild(run.child); rmSync(cwd, { recursive: true, force: true }); }
});

test("DX9 serveUntilSignal keeps probe alive and reaps owned hosts on TERM", {timeout:20000}, async t => {
  const cwd=mkdtempSync(join(tmpdir(),"sb4-probe-signal-"));
  mkdirSync(join(cwd,"dist"));writeFileSync(join(cwd,"dist/index.html"),"probe");
  const driver=join(cwd,"probe.mjs");
  writeFileSync(driver,`import {startStatic,serveUntilSignal} from ${JSON.stringify(new URL('../dist/proof.js',import.meta.url).href)};
const host=await startStatic('dist');
const held=serveUntilSignal([host]);
console.log(JSON.stringify({url:host.url,pid:host.pid}));
await held;`);
  const child=spawn(process.execPath,[driver],{cwd,stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{try {if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}finally{rmSync(cwd,{recursive:true,force:true});}});
  let output='',errors='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>errors+=bytes);
  const host=await waitForServer(()=>output.includes('\n')?JSON.parse(output.trim()):null,Boolean,{timeoutMs:10000,label:'probe JSON'});
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(child.exitCode,null,errors);
  assert.equal(await (await fetch(host.url)).text(),'probe');
  child.kill('SIGTERM');assert.deepEqual(await bounded(closed,10000,'probe signal shutdown'),{code:0,signal:null},errors);
  await assert.rejects(fetch(host.url));
});
