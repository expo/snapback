// Actual dev + SDK, no proxy, fake fetch, or synthetic socket error. SIGSTOP
// models a descheduled server after its bounded read has begun. The kernel's
// receive timeout expires while it is stopped; resume happens after the SDK
// has written on the old connection. This makes the unread-data reset visible.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { channel } from "node:diagnostics_channel";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../../packages/snapback4/dist/client.js";

const binary = process.env.SNAPBACK4_BIN ?? resolve("target/debug/snapback4");
const transport = process.env.KA_BASELINE_FETCH ? (await import("./baseline-node-fetch.js")).defaultFetch : undefined;
for (let round = 0; round < Number(process.env.KA_ROUNDS ?? 1); round++) test(`descheduled dev: idle pooled SDK socket (${round})`, { timeout: 20_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-ka-deschedule-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), "use personas alice\nquery ping():\n  return 1\n");
  const child = spawn(binary, ["dev", "--no-watch", "--port", "0"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let output = "", log = "", resumed;
  child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { log += data; });
  const clients = [];
  t.after(async () => {
    clearTimeout(resumed);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGCONT");
    await Promise.all(clients.map(client => client.close()));
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited; rmSync(dir, { recursive: true, force: true });
  });
  let url;
  for (let n = 0; n < 500 && !url; n++) {
    assert.equal(child.exitCode, null, log);
    url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (!url) await delay(10);
  }
  assert.ok(url, log);
  const errors = [], failures = channel("undici:request:error");
  const record = ({ request, error }) => { if (String(request.origin) === url) errors.push({ code: error.code, message: error.message }); };
  failures.subscribe(record); t.after(() => failures.unsubscribe(record));
  for (let n = 0; n < Number(process.env.KA_CLIENTS ?? 1); n++) clients.push(createClient({ url, persona: "alice", ...(transport ? { fetch: transport } : {}) }));
  const query = () => Promise.all(clients.map(client => client.query({ kind: "query", name: "ping" }, {})));
  assert.ok((await query()).every(read => read.data === 1));
  await delay(3500);
  child.kill("SIGSTOP");
  const until = performance.now() + 1800; while (performance.now() < until) {}
  resumed = setTimeout(() => child.kill("SIGCONT"), 150);
  const reads = await query();
  assert.equal(child.exitCode, null, log);
  console.log(JSON.stringify({ round, clients: clients.length, errors, successes: reads.filter(r => r.data === 1).length, failures: reads.filter(r => r.data !== 1), serverAlive: child.exitCode === null, serverLog: log }));
  assert.ok(reads.every(read => read.data === 1), JSON.stringify(reads));
});
