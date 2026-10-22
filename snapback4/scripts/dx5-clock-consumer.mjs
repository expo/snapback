// Runs unchanged against source dist or a packed installed consumer.
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { deploy, startServe, cli } from "snapback4/proof";
import { signup } from "snapback4/auth";

mkdirSync("snapback", { recursive: true });
writeFileSync("snapback/schema.q", `use identity password
table items:
  owner: principal
  placedAt: time default now
  status: enum('pending', 'released')
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- viewer = 'service:operator'
  cap 1000
  online only
mutation add():
  return insert items { owner: viewer, status: 'pending' }
query mine():
  return items where .owner = viewer first 50 by .id
job releaseOld():
  for b in items by .id:
    if b.status = 'pending' and b.placedAt + 48h < now:
      update items[b.id] { status: 'released' }
schedule releaseHourly every 1h: releaseOld
`);
await deploy("staging", "snapback", {args:["--staging"]});
let host = await startServe("staging", {clockOffset:"+30m"});
let account;
const post = async (route, args = {}) => {
  const response = await fetch(host.url + route, {method:"POST", headers:{authorization:`Bearer ${account.session.token}`}, body:JSON.stringify({args}), signal:AbortSignal.timeout(10000)});
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
};
try {
  account = await signup(host.url, "clock@example.test", "clock-example-password"); assert.equal(account.ok, true);
  assert.equal((await post("/m/add")).state, "sent");
  const before = await host.now(), advance = await host.advance("49h");
  assert.ok(advance.now - before >= 49 * 3600000);
  assert.deepEqual(advance.fired.map(s => s.name), ["releaseHourly"]);
  assert.equal(advance.held.length, 0);
  assert.ok(advance.fired[0].firedWindows.length === 1 && advance.fired[0].skippedPeriods > 0);
  assert.equal(advance.fired[0].run.state, "done");
  assert.equal((await post("/q/mine")).data[0].status, "released");
} finally { await host.stop(); }
host = await startServe("staging");
try {
  assert.equal((await post("/m/add")).state, "sent");
  await assert.rejects(host.advance("49h"), /E_CLOCK_HELD/);
  const report = await host.advance("49h", {allowHeld:true});
  assert.equal(report.fired.length, 0);
  assert.equal(report.held.length, 1);
  assert.equal(report.held[0].holdCode, "saved-boundary");
  assert.match(report.held[0].reason, /already processed.*One fire per boundary/);
  assert.match(report.held[0].reason, /fresh staging/);
  assert.equal((await post("/q/mine")).data.filter(r => r.status === "pending").length, 1);
  const held = await cli(["clock", "advance", "1ms", "--release", "staging", "--allow-held"]);
  assert.equal(held.code, 0, held.stderr);
  assert.match(held.stderr, /schedule releaseHourly:.*already processed/);
  const body = JSON.parse(held.stdout);
  assert.equal(body.held.length, 1); assert.equal(body.fired.length, 0);
  assert.doesNotMatch(body.sessionNotice, /unsafe-dev-doors/);
  const resumed = await host.advance("2h"); assert.equal(resumed.fired.length, 1);
  assert.ok((await post("/q/mine")).data.every(r => r.status === "released"));
  console.log("DX5 staging: fired, persisted/equal boundary held, CLI notice and recovery passed");
} finally { await host.stop(); }
