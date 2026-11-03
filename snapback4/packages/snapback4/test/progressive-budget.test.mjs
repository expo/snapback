// @ref LLP 3000.001.001#61-the-acquisition-page — a budget-limited tier-1 prefix is a successful page; only an indivisible actual row refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, source, query } from "./helpers/progressive-acquisition.mjs";
import { localStatus } from "../dist/local-status.js";
import { hangBudget } from "./helpers/wait.mjs";

for (const tier of ["process", "wasm"]) {
  test(`${tier}: tier-1 heap stops are ordinary cursor progress through explicit sync`, { timeout: hangBudget(120) }, async t => {
    const rows = Array.from({ length: 1200 }, (_, n) => ({ table: "payloads", row: { id: `r${String(n).padStart(4, "0")}`, body: "x".repeat(8192) } }));
    const f = await fixture(t, tier, { limit: 8192, rows,
      source: "use personas alice\ntable payloads:\n  body: text <=262144\n  public 'fixture'\n  sync\n" });
    const client = await f.open(); f.allow(true); await client.sync();
    assert.equal(client.acquired, true);
    const pages = f.pages.filter(p => p.acquire);
    assert.ok(pages.length > 1, "heap-limited table should span multiple requests");
    const ids = pages.flatMap(p => p.events.map(e => e.id));
    assert.equal(ids.length, rows.length); assert.equal(new Set(ids).size, rows.length);
    for (const p of pages.slice(0, -1)) {
      assert.equal(p.denied, undefined); assert.ok(p.acquire.cursor);
      assert.deepEqual(p.acquire.whole_tables, []);
    }
    assert.deepEqual(pages.at(-1).acquire.whole_tables, ["payloads"]);
    assert.equal(localStatus(client).getSnapshot().why, undefined);
  });

  test(`${tier}: a heap-bound acquisition row recovers through staged replacement`, { timeout: hangBudget(120) }, async t => {
    // JSON is compact on the wire but its million array cells exceed the
    // actual 16 MiB retained heap allowance, even at a one-row page limit.
    const f = await fixture(t, tier, { limit: 1,
      source: "use personas alice\ntable payloads:\n  body: json <=20000000\n  public 'fixture'\n  sync\n",
      rows: [{ table: "payloads", row: { id: "large", body: Array(1_000_000).fill(0) } }] });
    const client = await f.open(); f.allow(true); await client.sync();
    assert.equal(client.acquired, true);
    const denied = f.pages.find(p => p.denied)?.denied;
    assert.equal(denied?.code, "E_BOUND"); assert.equal(denied.family, "bound");
    assert.match(denied.message, /heap/i);
    assert.ok(f.requests.some(request => !request.acquire && !request.stream && request.from === 0), "the acquisition refusal tries staged replacement");
    const replacement = f.pages.find(page => page.snapshot && !page.denied);
    assert.equal(replacement.events[0].data.body.length, 1_000_000);
    assert.equal(localStatus(client).getSnapshot().state, "ready");
    await client.close(); f.online(false);
    const reopened = await f.open();
    assert.equal(reopened.acquired, true, "the replacement publication survives offline reopen");
  });
}

// The measurement harness's inbox reads a membership page plus each thread.
// Exercise its known/complete milestone with schema order deliberately putting
// conversations first. This runs the new Rust code in the native process;
// wasm is rebuilt and qualified by the supervisor.
test("process: inbox milestone waits for the last rule dependency and survives offline reopen", { timeout: hangBudget(120) }, async t => {
  const schema = source.replaceAll("threads", "conversations")
    .replace("  cap 50 by threadId", "  until: time ?\n  expire at .until\n  cap 50 by threadId")
    .replace("return participants where .personId = viewer first 50 by .threadId",
      "return participants where .personId = viewer first 50 by .threadId\n    { threadId, conversation: conversations[.threadId] }");
  const f = await fixture(t, "process", { source: schema, limit: 1, rows: [
    { table: "conversations", row: { id: "a", subject: "present" } },
    { table: "participants", row: { id: "pa", threadId: "a", personId: "dev:alice", until: null } },
    { table: "messages", row: { id: "a1", conversation: "a", body: "one", at: 1 } },
  ] });
  const client = await f.open();
  await f.through(client, s => s.acquired_tables.length === 1);
  assert.deepEqual((await f.state()).acquired_tables, ["conversations"]);
  const watermark = (await f.state()).watermark;
  assert.equal((await f.raw("thread", { c: "a" })).unknown, true);
  assert.equal((await f.raw("inbox", {})).unknown, true);
  await f.through(client, s => s.acquired_tables.length === 2);
  const inbox = await f.raw("inbox", {});
  assert.ok(inbox && !inbox.unknown && inbox.complete && Array.isArray(inbox.data), JSON.stringify(inbox));
  assert.equal(inbox.data[0].conversation.id, "a");
  const state = await f.state();
  assert.equal(state.watermark, watermark); assert.equal(state.acquired, false); assert.equal(state.floored_groups, 0);
  await client.close(); f.online(false);
  const reopened = await f.open(), offline = await reopened.query(query("inbox"), {});
  assert.equal(offline.complete, true); assert.equal(offline.fresh, false);
  assert.equal(offline.data[0].conversation.id, "a"); assert.equal(reopened.acquired, false);
});
