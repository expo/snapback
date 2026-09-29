import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { runWorker } from "../dist/worker.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
async function until(probe) {
  for (let i = 0; i < 200; i++) { const result = await probe(); if (result) return result; await sleep(50); }
  throw Error("worker witness timed out");
}
function command(cwd, args) {
  const result = spawnSync(binary, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
for (const mode of ["dev", "serve"]) test(`${mode} declares two workers, injects usable secret seats, restarts independently and stops both`, { timeout: 30_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-named-workers-"));
  mkdirSync(join(dir, "snapback/workers"), { recursive: true });
  writeFileSync(join(dir, "snapback/schema.q"), "effect notify\nmutation send():\n  emit notify { message: 'hello' }\n  return true\n");
  for (const name of ["push", "digest"]) writeFileSync(join(dir, `snapback/workers/${name}.mjs`), `
import { appendFileSync } from 'node:fs';
const token = process.env.SNAPBACK_SERVICE_TOKEN;
process.stdout.write('token:' + token.slice(0, 9));
await new Promise(resolve => setTimeout(resolve, 10));
process.stdout.write(token.slice(9) + '\\n');
console.error('also:' + token);
const response = await fetch(process.env.SNAPBACK_URL + '/effects/claim', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ effect: 'notify', limit: 1, wait: 0 }) });
const reply = await response.json();
if (!response.ok || reply.denied || !Array.isArray(reply.effects)) throw Error('injected seat did not authenticate');
console.log('authenticated:${name}');
console.log('ledger:' + process.env.SNAPBACK_WORKER_LEDGER);
appendFileSync('starts-${name}.jsonl', JSON.stringify({ pid: process.pid }) + '\\n');
process.once('SIGTERM', () => { console.log('stopped:${name}'); process.exit(0); });
setInterval(() => {}, 1000);
`);
  const release = join(dir, "release");
  if (mode === "serve") command(dir, ["deploy", release]);
  const workdir = mode === "dev" ? dir : join(release, "releases/1");
  const child = spawn(binary, mode === "dev" ? [mode, "--port", "0", "--no-watch"] : [mode, release, "--port", "0"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let stdout = "", stderr = "";
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  });
  const starts = name => { try { return readFileSync(join(workdir, `starts-${name}.jsonl`), "utf8").trim().split("\n").map(JSON.parse); } catch { return []; } };
  await until(() => starts("push").length === 1 && starts("digest").length === 1);
  const db = new DatabaseSync(join(mode === "dev" ? join(dir, ".snapback4") : release, "store.sqlite"), { readOnly: true });
  assert.deepEqual(db.prepare("SELECT DISTINCT principal FROM _sessions WHERE kind = 'service' ORDER BY principal").all().map(row => row.principal), ["service:digest", "service:push"]);
  db.close();
  assert.match(stdout.trim(), /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const name of ["push", "digest"]) {
    assert.match(stderr, new RegExp(`\\[worker:${name}\\] token:\\[REDACTED\\]`));
    assert.match(stderr, new RegExp(`\\[worker:${name}\\] also:\\[REDACTED\\]`));
    assert.match(stderr, new RegExp(`\\[worker:${name}\\] authenticated:${name}`));
  }
  assert.equal(stderr.includes("printed once"), false);
  process.kill(starts("push")[0].pid, "SIGKILL");
  await until(() => starts("push").length === 2);
  assert.equal(starts("digest").length, 1);
  const doctor = command(dir, ["doctor", ...(mode === "serve" ? ["--release", release] : [])]);
  assert.match(doctor, /"name":"push".*"restarts":1/);
  assert.match(doctor, /"name":"digest".*"restarts":0/);
  const expectedLedger = join(mode === "dev" ? join(dir, ".snapback4") : release, "worker-ledger.sqlite");
  assert.ok(stderr.includes(`ledger:${expectedLedger}`));
  child.kill("SIGTERM"); await exited;
  for (const name of ["push", "digest"]) assert.throws(() => process.kill(starts(name).at(-1).pid, 0), { code: "ESRCH" });
});

test("standalone runWorker replays a durable completion after losing acknowledgement and restarting", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-worker-ledger-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let actions = 0;
  const keys = [], results = [];
  for (const attempt of [1, 2]) {
    const stop = new AbortController();
    let claimed = false;
    const worker = runWorker({ url: "http://standalone.test", token: "standalone-token", ledger: join(dir, "effects.sqlite"), signal: stop.signal,
      effects: { notify: (_payload, meta) => { actions++; keys.push(meta.idempotencyKey); return { providerId: meta.idempotencyKey }; } },
      fetch: async (url, init) => {
        if (url.endsWith("/claim")) {
          if (claimed) throw Error("unexpected second poll");
          claimed = true;
          return Response.json({ worker: "service:standalone", effects: [{ id: "stable-effect", effect: "notify", payload: {}, attempt, seq: 1, at: 10, leaseToken: `lease-${attempt}` }] });
        }
        if (url.endsWith("/done")) {
          results.push(JSON.parse(init.body).result);
          stop.abort();
          if (attempt === 1) throw Error("acknowledgement lost");
          return Response.json({ ok: true });
        }
        throw Error("settlement unavailable");
      }, onError() {},
    });
    await worker.done;
  }
  assert.equal(actions, 1);
  assert.deepEqual(keys, ["stable-effect"]);
  assert.deepEqual(results, [{ providerId: "stable-effect" }, { providerId: "stable-effect" }]);
});

test("ledger rolls back a failed handler and never treats failure as completion", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-worker-ledger-failed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0, attempt = 0;
  const stop = new AbortController();
  const worker = runWorker({ url: "http://standalone.test", token: "seat", ledger: join(dir, "effects.sqlite"), signal: stop.signal,
    effects: { notify: () => { if (++calls === 1) throw Error("provider unavailable"); return "sent"; } },
    fetch: async url => {
      if (url.endsWith("/claim")) return Response.json({ effects: [{ id: "retry", effect: "notify", payload: {}, attempt: ++attempt, seq: 1, at: 0 }] });
      if (url.endsWith("/done")) stop.abort();
      return Response.json({ ok: true });
    },
  });
  await worker.done;
  assert.equal(calls, 2);
});

test("two standalone processes sharing a ledger perform one action, then replay after both exit", { timeout: 15_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-worker-shared-ledger-"));
  const children = [];
  t.after(async () => {
    for (const { child, done } of children) { if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL"); await done; }
    rmSync(dir, { recursive: true, force: true });
  });
  const script = join(dir, "worker.mjs");
  writeFileSync(script, `
import { appendFileSync } from 'node:fs';
import { runWorker } from ${JSON.stringify(new URL("../dist/worker.js", import.meta.url).href)};
const stop = new AbortController();
await runWorker({ url: 'http://test', token: 'test-seat', ledger: 'completions.sqlite', signal: stop.signal,
  effects: { notify: async () => {
    appendFileSync('actions', 'performed\\n');
    await new Promise(resolve => setTimeout(resolve, 200));
    return 'provider-receipt';
  } },
  fetch: async url => {
    if (url.endsWith('/claim')) return Response.json({ effects: [{ id: 'one-delivery', effect: 'notify', payload: {}, attempt: 1, seq: 1, at: 0 }] });
    stop.abort();
    if (url.endsWith('/done')) throw Error('lost acknowledgement');
    throw Error('server unreachable');
  }, onError() {},
}).done;
`);
  function start() {
    const child = spawn(process.execPath, [script], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const done = once(child, "exit");
    let log = ""; child.stderr.on("data", bytes => { log += bytes; });
    children.push({ child, done });
    return done.then(([code]) => assert.equal(code, 0, log));
  }
  await Promise.all([start(), start()]);
  await start();
  assert.equal(readFileSync(join(dir, "actions"), "utf8"), "performed\n");
});
