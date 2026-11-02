// @ref LLP 3000.001.001#101-correctness-witnesses — public client, actual server, and both shipped device adapters at intermediate publication boundaries.
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, query } from "./helpers/progressive-acquisition.mjs";
import { waitFor, hangBudget } from "./helpers/wait.mjs";
import { acquisition, acquisitionProgress } from "../dist/acquisition.js";
import { foregroundHint, LocalAcquisition } from "../dist/local-acquisition.js";
import { localStatus } from "../dist/local-status.js";

const history = (client, c, page = null) => client.query(query("history"), { c, page });
const state0 = { acquired: false, acquisition_cursor: null, acquisition_exhausted: false, acquired_tables: [], floored_groups: 0, replacement_required: false };
const compatible = { advertised: ["progressive-acquisition-v1"] };
const group = c => ({ table: "messages", group: [c] });

test("scheduler negotiates both peers and drains a same-watermark deferred page after reopen", () => {
  const walk = new LocalAcquisition();
  assert.equal(walk.request({}, state0, [], false), undefined);
  assert.equal(walk.request(compatible, { acquired: false }, [], false), undefined);
  assert.equal(walk.request(compatible, { ...state0, replacement_required: true }, [], false), undefined);
  assert.equal(walk.request(compatible, state0, [], true), undefined);
  assert.deepEqual(walk.request(compatible, state0, [group("b"), group("b")], false), { acquire: { cursor: null, hint: group("b"), skip: [] } });
  walk.applied({ acquire: { unit: { tier: 2, ...group("b") } }, events: [], more: true }, false);
  assert.deepEqual(walk.request(compatible, state0, [], false), { stream: true });
  const reopened = new LocalAcquisition();
  assert.deepEqual(reopened.request(compatible, { ...state0, watermark: 0, transfer_watermark: 0,
    adoption_capture: { "device:deferred:cursor": "0" } }, [], false), { stream: true });
  reopened.applied({ events: [], more: false }, true);
  assert.equal(reopened.request(compatible, { ...state0, acquisition_cursor: "durable" }, [], false).acquire.cursor, "durable");
  assert.deepEqual(reopened.request(compatible, { ...state0, acquisition_exhausted: true }, [], false), { stream: true });
});

test("progress reports published usable facts, revocation, and received row images independently", () => {
  const progress = acquisitionProgress(), client = {};
  progress.bind(client); const read = acquisition(client).read;
  const page = { acquire: {}, events: [{ kind: "put", table: "messages" }] };
  progress.page(page, true, false);
  assert.deepEqual(read(), { acquired: false, rows: 0, tables: Object.create(null), usable: { tables: 0, groups: 0 } });
  progress.page({ events: [] }, false, true);
  progress.usable({ acquired_tables: ["threads", "participants"], floored_groups: 1 });
  assert.deepEqual(read().usable, { tables: 2, groups: 1 }); assert.equal(read().rows, 1);
  progress.usable({ acquired_tables: ["threads", "participants"], floored_groups: 0 });
  assert.equal(read().usable.groups, 0); assert.equal(read().acquired, false);
});

for (const tier of ["process", "wasm"]) {
  test(`${tier}: online fallback renders during acquisition and older pages do not enlarge the replica`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    const hold = matches => {
      let entered, release, held = false;
      const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
      f.intercept(async body => { if (!held && matches(body)) { held = true; entered(); await gate; } });
      return { started, release };
    };
    let firstUnit = false;
    f.onApply(page => { if (page.acquire) firstUnit = true; });
    const early = hold(body => firstUnit && body.stream);
    f.allow(true); // The background follow loop publishes the unit.
    try {
      await early.started;
      const before = f.queries.length, answer = await history(client, "b");
      assert.equal(client.acquired, false); assert.equal(answer.complete, true);
      assert.deepEqual(answer.data.map(r => r.id), ["b4", "b3"]);
      assert.ok(f.queries.length > before, "unknown local history rendered its online answer");
      assert.equal((await f.raw("history", { c: "b", page: null })).unknown, true);
    } finally { f.allow(false); early.release(); f.intercept(undefined); f.onApply(undefined); }
    const observed = client.observe(query("history"), { c: "a", page: null }, { keep: false });
    await f.through(client, s => s.floored_groups === 1); observed.close();
    const later = hold(body => !!body.acquire);
    f.allow(true);
    try {
      await later.started;
      const newest = await history(client, "a"), before = f.queries.length;
      assert.equal(newest.complete, true);
      const older = await history(client, "a", newest.next);
      assert.equal(older.complete, true); assert.deepEqual(older.data.map(r => r.id), ["a2", "a1"]);
      assert.ok(f.queries.length > before, "past-floor page came from the server");
      const local = await f.raw("history", { c: "a", page: newest.next });
      assert.equal(local.complete, false); assert.deepEqual(local.data, [], "server fallback did not persist older history");
      assert.equal(client.acquired, false);
    } finally { f.allow(false); later.release(); f.intercept(undefined); }
  });
  test(`${tier}: cold pin skips historical joins and publishes tier 1 then the hinted group`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    const observed = client.observe(query("history"), { c: "c", page: null }, { keep: false });
    await f.through(client, s => s.acquired_tables.length === 2);
    assert.equal((await f.state()).floored_groups, 0);
    const first = f.pages.find(p => p.acquire);
    assert.equal(first.acquire.pinned, true);
    assert.ok(first.watermark > 0); assert.equal(first.watermark, first.images_at);
    await f.through(client, s => s.floored_groups === 1);
    const firstGroup = f.pages.findIndex(p => p.acquire?.unit?.tier === 2);
    assert.deepEqual(f.pages[firstGroup].acquire.unit.group, ["c"]);
    assert.equal(f.pages.slice(0, firstGroup).filter(p => !p.acquire).flatMap(p => p.acquisitions ?? []).length, 0,
      "no historical join expansions before the first tier-2 unit");
    assert.ok(f.requests.every(r => !(r.from === 0 && r.stream === true)));
    assert.equal(client.acquired, false);
    observed.close();
    f.allow(true);
    await client.sync(); assert.equal(client.acquired, true);
    for (const c of f.groups) assert.equal((await history(client, c)).complete, true);
  });
  test(`${tier}: one explicit cold sync resolves acquired with every table whole and group floored`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    f.allow(true); await client.sync();
    assert.equal(client.acquired, true);
    const state = await f.state();
    assert.equal(state.acquired, true); assert.equal(state.acquisition_exhausted, true);
    assert.deepEqual(state.acquired_tables, ["participants", "threads"]);
    assert.equal(state.floored_groups, f.groups.length);
    assert.ok(f.pages.some(p => p.acquire?.pinned));
    assert.ok(f.requests.every(r => !(r.from === 0 && r.stream === true)));
  });
  test(`${tier}: a join committed after the pin still expands and becomes usable`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    await f.through(client, s => s.watermark > 0);
    const pin = (await f.state()).watermark;
    assert.equal((await f.post("/seed", [
      { table: "threads", row: { id: "later", subject: "joined after pin" } },
      { table: "participants", row: { id: "plater", threadId: "later", personId: "dev:alice" } },
      { table: "messages", row: { id: "later1", conversation: "later", body: "new group", at: 1 } },
    ])).seeded, 3);
    await f.through(client, s => s.acquired_tables.length === 2);
    assert.ok((await f.state()).watermark > pin);
    assert.ok(f.pages.some(p => !p.acquire && p.acquisitions?.some(a => a.group[0] === "later" && a.floor)));
    assert.ok(!f.pages.some(p => p.acquire?.unit?.tier === 2));
    assert.equal((await f.state()).floored_groups, 1);
    f.online(false);
    const read = await history(client, "later");
    assert.equal(read.complete, true); assert.deepEqual(read.data.map(r => r.id), ["later1"]);
    assert.equal(client.acquired, false);
  });
  test(`${tier}: tier 1 inbox survives offline reopen before any history is usable`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    assert.deepEqual(foregroundHint(f.backend, "history", { c: "b", page: null }), group("b"), JSON.stringify(f.backend.programs.find(p => p.name === "history")));
    assert.equal(foregroundHint(f.backend, "total", { c: "b" }), undefined);
    await f.through(client, s => s.acquired_tables.length === 2);
    assert.equal(client.acquired, false);
    assert.deepEqual(acquisition(client).read().usable, { tables: 2, groups: 0 });
    assert.equal(localStatus(client).getSnapshot().state, "syncing");
    const cursor = (await f.state()).acquisition_cursor;
    assert.ok(cursor);
    await client.close(); f.online(false);
    const reopened = await f.open();
    assert.deepEqual(acquisition(reopened).read().usable, { tables: 2, groups: 0 });
    const inbox = await reopened.query(query("inbox"), {});
    assert.equal(inbox.complete, true); assert.equal(inbox.data.length, 5); assert.equal(inbox.fresh, false); assert.equal(typeof inbox.since, "number");
    assert.equal((await history(reopened, "a")).denied?.code, "E_OFFLINE");
    assert.equal((await f.raw("history", { c: "a", page: null })).unknown, true);
    assert.equal(reopened.acquired, false); assert.equal((await f.state()).acquisition_cursor, cursor);
  });

  test(`${tier}: A is complete offline after reopen, B unknown, floor and scalar answers stay truthful`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    const observed = client.observe(query("history"), { c: "c", page: null });
    const stop = observed.subscribe(() => {});
    await f.through(client, s => s.floored_groups === 1);
    assert.deepEqual(f.pages.find(p => p.acquire?.unit?.tier === 2).acquire.unit.group, ["c"]);
    assert.equal(client.acquired, false);
    assert.deepEqual(acquisition(client).read().usable, { tables: 2, groups: 1 });
    stop(); observed.close();
    const cursor = (await f.state()).acquisition_cursor;
    await client.close(); f.online(false);
    const reopened = await f.open(), a = await history(reopened, "c");
    assert.equal(a.complete, true); assert.deepEqual(a.data.map(r => r.id), ["c4", "c3"]); assert.equal(a.fresh, false);
    const pastFloor = await history(reopened, "c", a.next);
    assert.equal(pastFloor.complete, false, JSON.stringify(pastFloor));
    const b = await history(reopened, "b");
    assert.ok(b.denied?.code === "E_OFFLINE" || b.complete === false, JSON.stringify(b));
    assert.equal((await f.raw("history", { c: "b", page: null })).unknown, true);
    assert.equal((await f.raw("missing", { m: "b-no-row" })).unknown, true);
    assert.equal((await f.raw("total", { c: "c" })).unknown, true);
    assert.equal((await reopened.query(query("one"), { m: "c4" })).data.id, "c4");
    assert.equal(reopened.acquired, false); assert.equal((await f.state()).acquisition_cursor, cursor);
    assert.deepEqual(acquisition(reopened).read().usable, { tables: 2, groups: 1 });
    const requestStart = f.requests.length;
    f.online(true); f.allow(true); await reopened.sync();
    await waitFor(async () => { await reopened.sync(); return reopened.acquired; }, "walk did not resume");
    const resumed = f.requests.slice(requestStart).find(r => r.acquire);
    assert.equal(resumed.acquire.cursor, cursor);
    assert.equal((await history(reopened, "empty")).complete, true);
    assert.deepEqual((await history(reopened, "empty")).data, []);
    assert.equal(f.maxInflight(), 1);
  });

  for (const retained of [false, true]) test(`${tier}: revocation during acquisition withdraws usable group (${retained ? "delivered" : "until-revoked"})`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier, { retained }), client = await f.open();
    const observed = client.observe(query("history"), { c: "a", page: null }, { keep: false });
    await f.through(client, s => s.floored_groups === 1);
    observed.close();
    assert.equal((await f.post("/m/leave", { args: { m: "pa" } })).state, "sent");
    const before = f.applies.length;
    await f.through(client, () => f.applies.slice(before).some(a => a.page.events.some(e => e.kind === "scope")));
    const groups = retained ? 1 : 0; // Delivered-history preserves its already-published floor.
    assert.equal(client.acquired, false); assert.equal(acquisition(client).read().usable.groups, groups);
    await client.close(); f.online(false); const reopened = await f.open();
    const read = await history(reopened, "a");
    if (retained) { assert.deepEqual(read.data.map(r => r.id), ["a4", "a3"]); assert.equal(read.fresh, false); }
    else assert.equal(read.data?.some(r => r.id === "a4"), undefined);
    assert.equal(acquisition(reopened).read().usable.groups, groups);
  });

  test(`${tier}: interactive send settles during the walk; hints switch, coalesce and unmount without starving completion`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    await f.through(client, s => s.acquired_tables.length === 2);
    const prediction = await f.core().call({ op: "predict", name: "add", viewer: "dev:alice", args: { c: "d", body: "preview" }, newIds: ["preview"], now: Date.now() });
    assert.equal(prediction.ok.denied.code, "E_PREDICT");
    let observed = client.observe(query("history"), { c: "d", page: null }, { keep: false });
    const twin = client.observe(query("history"), { c: "d", page: null }, { keep: false });
    const stop = observed.subscribe(() => {}), stopTwin = twin.subscribe(() => {});
    let entered, release, held = false, writeId, settledDuringAcquisition = false, acquisitionsAtSend;
    const orderStart = f.order.length;
    client.onWrite(w => { if (w.id === writeId) { settledDuringAcquisition = !client.acquired; acquisitionsAtSend = f.order.slice(orderStart).filter(kind => kind === "acquire").length; } });
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.intercept(async body => { if (body.acquire && !held) { held = true; entered(); await gate; } });
    let traffic = 0;
    const hints = ["c", "b", "empty", "a"];
    f.onApply(async page => {
      if (!page.acquire) return;
      // Keep real stream traffic arriving while the cursor's fairness bit must
      // still take normal steps between the changing foreground priorities.
      assert.equal((await f.post("/m/add", { args: { c: "d", body: `traffic ${++traffic}` } })).state, "sent");
      stopTwin(); twin.close(); stop(); observed.close();
      observed = client.observe(query("history"), { c: hints[(traffic - 1) % hints.length], page: null }, { keep: false });
    });
    f.allow(true);
    await started;
    const write = await client.mutate({ kind: "mutation", name: "add" }, { c: "d", body: "during acquisition" }, { waitSeconds: 0 });
    writeId = write.id;
    assert.equal(write.state, "pending");
    assert.equal((await f.core().call({ op: "queued" })).ok.find(e => e.id === write.id).predictable, false);
    release();
    await waitFor(async () => (await client.write(write.id))?.state === "sent" && acquisitionsAtSend !== undefined, "send was starved by acquisition");
    assert.equal(settledDuringAcquisition, true, "send settled before exhaustion");
    const firstWrite = f.order.indexOf("write", orderStart);
    assert.equal(f.order.slice(orderStart, firstWrite).filter(kind => kind === "acquire").length, 1,
      "queued POST precedes the next acquisition unit; onWrite follows its ordinary receipt catch-up");
    await waitFor(() => client.acquired, "foreground switching starved the background walk");
    observed.close();
    const served = f.pages.filter(p => p.acquire?.unit?.tier === 2).map(p => p.acquire.unit.group[0]);
    assert.equal(new Set(served).size, served.length, JSON.stringify(served));
    assert.equal(served[0], "d");
    assert.ok(f.requests.filter(r => r.acquire?.hint?.group[0] === "d").length <= 1);
    assert.ok(f.pages.some(p => p.acquire?.skipped?.some(s => s.group[0] === "d")));
    assert.equal((await f.state()).acquisition_exhausted, true);
    assert.equal(localStatus(client).getSnapshot().state, "ready");
    assert.equal(acquisition(client).read().acquired, true);
    assert.equal(f.maxInflight(), 1);
  });

  for (const peer of ["server", "device"]) test(`${tier}: old ${peer} uses legacy snapshots without any acquire request`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier, { legacy: peer === "server", oldDevice: peer === "device" });
    f.allow(true); const client = await f.open();
    await client.sync(); assert.equal(client.acquired, true);
    assert.ok(f.pages.some(p => p.snapshot));
    assert.ok(f.requests.every(r => !Object.hasOwn(r, "acquire")));
    assert.equal((await history(client, "a")).complete, true);
  });
  test(`${tier}: a partial walk reopens against an old server through staged replacement`, { timeout: hangBudget(120) }, async t => {
    const f = await fixture(t, tier), client = await f.open();
    await f.through(client, s => s.acquired_tables.length === 2);
    assert.equal(client.acquired, false); await client.close();
    f.advertise(false); f.allow(true);
    const start = f.requests.length, reopened = await f.open();
    await reopened.sync();
    assert.equal(reopened.acquired, true);
    assert.ok(f.requests.slice(start).every(r => !Object.hasOwn(r, "acquire")));
    assert.equal(f.requests[start].from, 0);
    assert.ok(f.applies.some(a => a.page.stage_snapshot));
    assert.equal((await history(reopened, "b")).complete, true);
  });
}

test("browser React hooks and IndexedDB close/reopen", { skip: "not run (sandbox): react.test.mjs and witness/idb.mjs SIGABRT; supervisor owns browser validation" }, () => {});
