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
let host = await startServe("staging", {clockOffset:"+2h"});
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
  const report = await host.advance("49h");
  assert.equal(report.fired.length, 1, "reused staging continues from its own offset");
  assert.ok((await post("/q/mine")).data.every(r => r.status === "released"));
  const next = await cli(["clock", "advance", "1ms", "--release", "staging"]);
  assert.equal(next.code, 0, next.stderr);
  const body = JSON.parse(next.stdout);
  assert.equal(body.held[0].holdCode, "not-due");
  assert.match(body.message, /persists with this staging store/);
  console.log("DX5 staging: fired, persisted clock, CLI report and repeated store passed");
} finally { await host.stop(); }
