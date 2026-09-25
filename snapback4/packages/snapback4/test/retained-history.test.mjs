// Retained history on the real server and both real device hosts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const query = { kind: "query", name: "history" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 15000;
  do { if (await check()) return; await sleep(20); } while (Date.now() < end);
  assert.fail(message);
}
const source = `use personas alice, bob
use identity guests
table members:
  room: text <=40
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room
  immutable room, principal
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: text <=40
  at: time
  body: text <=40
  unique byRoomAt: room, at
  by byTime: room, at, id
  by byWords: room, words(body), at, id
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 25 by byTime
query history(room: text <=40):
  return messages[room] last 50 by byTime
query search(room: text <=40, q: text <=40, c: cursor ?):
  return merge messages matching q after c last 50 by byWords:
    [room]
query mixed():
  ignored = messages['left'] last 1 by byTime
  return messages['held'] last 50 by byTime
table current:
  room: text <=40
  body: text <=40
  by byRoom: room, id
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync to members[.room]
query three():
  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime, current: current['current'] first 50 by byRoom}
query completeOnly():
  return {current: current['current'] first 50 by byRoom, held: messages['held'] last 50 by byTime}
mutation removeCurrent():
  delete current['current-row']
query pointIndex():
  return {left: messages[room = 'left', at = 25], held: messages['held'] last 50 by byTime}
query pointId():
  return {left: messages['left-25'], held: messages['held'] last 50 by byTime}
query retainedPoint():
  return {left: messages['left'] last 50 by byTime, right: messages['held-0']}
query pointMiss():
  return {left: messages['left-0'], held: messages['held'] last 50 by byTime}
query pointExists():
  return {left: exists messages['left-25'], held: messages['held'] last 50 by byTime}
query both():
  leftRows = messages['left'] last 50 by byTime
  heldRows = messages['held'] last 50 by byTime
  return {left: leftRows, held: heldRows}
query heldBoth() held:
  leftRows = messages['left'] last 50 by byTime
  heldRows = messages['held'] last 50 by byTime
  return {left: leftRows, held: heldRows}
query cursorBoth(c: cursor ?):
  leftRows = messages['left'] last 50 by byTime
  heldRows = messages['held'] last 50 by byTime
  return {left: leftRows, held: heldRows}
query shared():
  allRows = messages['held'] last 50 by byTime
  return {left: allRows, held: allRows}
query combined():
  leftRows = messages['left'] last 50 by byTime
  heldRows = messages['held'] last 50 by byTime
  return {total: count(leftRows) + count(heldRows), other: 0}
query branch():
  if true:
    return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}
  return {left: [], held: []}
query loop():
  for i in range(0, 1):
    return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}
  return {left: [], held: []}
mutation send(room: text <=40, at: time, body: text <=40):
  insert messages {room, at, body}
query across():
  return messages[] first 100 by byId
mutation joinAs(room: text <=40, person: principal):
  insert members {room, principal: person}
mutation leaveAs(room: text <=40, person: principal):
  delete members[room = room, principal = person]
mutation join(room: text <=40):
  insert members {room, principal: 'dev:bob'}
mutation leave(room: text <=40):
  delete members[room = room, principal = 'dev:bob']
`;
for (const tier of ["wasm", "process"]) for (const scenario of ["W14A horizon-free matching", "W14A positive existence", "R5 history", "R1a empty search", "R1a mixed reads", "R2 mixed result", "R2 sync during reply", "MQ authoritative bound", "MQ speculative component", "MQ speculative events", "MQ expiry local left", "MQ expiry local watch left", "MQ local permit", "MQ local permit watch", "MQ ineligible", "MQ points", "MQ delete current", "MQ revoke current", "MQ rejoin", "MQ held change", "MQ close", "MQ sign-out", "MQ transport", "MQ adoption", "MQ reset", "MQ rotation", "MQ prediction", "MQ expiry left", "MQ expiry held", "MQ interrupted snapshot", "MQ retained snapshot"]) test(`${scenario} ${tier}: retained history and independent held coverage`, { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-retained-"));
  mkdirSync(join(directory, "snapback"));
  const expiring = scenario.startsWith("MQ expiry");
  let fixtureSource = expiring ? source.replace("  body: text <=40\n  unique", "  body: text <=40\n  expiresAt: time\n  expire at .expiresAt\n  by byExpiresAt: expiresAt\n  unique").replace("insert messages {room, at, body}", "insert messages {room, at, body, expiresAt: now + 3600000}") : source;
  const permitCase = scenario.startsWith("MQ local permit");
  if (permitCase) fixtureSource += `
table permits:
  room: text <=40
  principal: principal
  expiresAt: time
  expire at .expiresAt
  by byExpiresAt: expiresAt
  unique byRoomPrincipal: room, principal
  read <- .principal = viewer
  sync to .principal
table secrets:
  room: text <=40
  body: text <=40
  read <- exists permits[.room, viewer]
  sync to permits[.room]
query permitBoth():
  return { left: messages['left'] last 50 by byTime, right: messages['held'] last 50 by byTime, secret: secrets['secret'] }
`;
  const eventCase = scenario === "MQ speculative events";
  if (eventCase) fixtureSource += readFileSync(join(root, "crates/snapback4-lang/tests/fixtures/following-view.q"), "utf8")
    .replace("query home(c:", "query feedPage(c:") + `
table eventSwitch:
  enabled: bool
  public 'speculative component witness'
  online only
query home():
  return { older: messages['left'] last 50 by byTime, events: feedPosts last 10 by .at where exists eventSwitch['gate'] }
query homePage():
  return { older: messages['left'] last 50 by byTime, events: eventSwitch first 10 by byId }
`;
  const boundCase = scenario === "MQ authoritative bound";
  if (boundCase) fixtureSource += `
table payloads:
  at: time
  body: text <=50000
  by byTime: at, id
  public 'output bound witness'
  sync public last 1 by .at
query largeBoth():
  return { left: messages['left'] last 50 by byTime, right: payloads last 30 by .at }
`;
  const wordCase = scenario.startsWith("W14A");
  const horizonFree = scenario === "W14A horizon-free matching";
  if (wordCase) {
    if (horizonFree) fixtureSource = fixtureSource.replace("sync to members[.room] last 25 by byTime", "sync to members[.room]");
    const left = horizonFree ? "messages['left'] matching 'del' last 50 by byWords" : "exists (messages['left'] matching 'del' by byWords)";
    fixtureSource += `
table recent:
  room: text <=40
  at: time
  body: text <=40
  by byTime: room, at, id
  read <- exists members[.room, viewer]
  sync to members[.room] last 25 by byTime
query wordBoth():
  return {left: ${left}, right: recent['held'] last 50 by byTime}
`;
  }
  if (scenario === "MQ adoption") fixtureSource = fixtureSource.replace("return {left: leftRows, held: heldRows}", "return {left: leftRows, held: heldRows, epoch: 1}");
  writeFileSync(join(directory, "snapback/schema.q"), fixtureSource);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let child = spawn(binary, ["dev", "--port", "0", "--fresh", ...(scenario === "MQ adoption" ? [] : ["--no-watch"])], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  let exit = once(child, "exit");
  let log = "", url, client, releaseReply;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  t.after(async () => { releaseReply?.(); await client?.close(); if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); await exit; });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
  let session;
  if (scenario === "MQ rotation") {
    session = (await fetch(`${url}/auth/guest`, { method: "POST", body: "{}" }).then(r => r.json())).session;
    assert.ok(session?.token);
  }
  const post = async (path, body, persona = "alice") => {
    if (session && ["/m/join", "/m/leave"].includes(path)) { path += "As"; body = { ...body, args: { ...body.args, person: session.principal } }; }
    return fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona }, body: JSON.stringify(body) }).then((r) => r.json());
  };
  const rows = ["left", "held"].flatMap((room) => Array.from({ length: 26 }, (_, at) => ({ table: "messages", row: { id: `${room}-${at}`, room, at, body: at === 0 ? "needle" : "delivered" } })));
  if (expiring) {
    const target = scenario.endsWith("left") ? "left-25" : "held-25";
    const deadline = Date.now() + 3_600_000;
    for (const item of rows) item.row.expiresAt = item.row.id === target ? deadline : deadline + 86_400_000;
  }
  rows.push(...["left", "held"].map((room) => ({ table: "members", row: { id: `alice-${room}`, room, principal: "dev:alice" } })));
  rows.push({ table: "current", row: { id: "current-row", room: "current", body: "remove me" } }, { table: "members", row: { id: "alice-current", room: "current", principal: "dev:alice" } });
  if (wordCase) rows.push(...rows.filter(item => item.table === "messages" && item.row.room === "held").map(item => ({ table: "recent", row: item.row })));
  if (boundCase) rows.push(...Array.from({ length: 26 }, (_, at) => ({ table: "payloads", row: { id: `large-${at}`, at, body: "x".repeat(50000) } })));
  const permitDeadline = Date.now() + 3_600_000;
  if (permitCase) rows.push(
    { table: "permits", row: { id: "permit", room: "vault", principal: "dev:bob", expiresAt: permitDeadline } },
    { table: "secrets", row: { id: "secret", room: "vault", body: "private" } },
  );
  if (eventCase) rows.push({ table: "eventSwitch", row: { id: "gate", enabled: true } });
  assert.equal((await post("/seed", rows)).seeded, rows.length);
  if (eventCase) assert.equal((await post("/m/post", { args: { postId: "p3", parentId: null }, id: "event-p3" }, "bob")).state, "sent");
  for (const room of ["left", "held", "current"]) assert.equal((await post("/m/join", { args: { room }, id: `join-${room}` })).state, "sent");
  let offline = false, intercept, holdWrites = false, interruptSnapshot = false, snapshotStarted = false, deviceNow, interceptDevice;
  const syncPages = [];
  let syncedAt, querySince;
  let core;
  const delayedName = scenario === "MQ speculative component" ? "retainedPoint" : scenario.includes("current") ? "three" : "both";
  const requests = [], deviceAnswers = [], allRequests = [], allAnswers = [];
  const directoryDevice = join(directory, "device"); mkdirSync(directoryDevice);
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: directoryDevice, spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const clientOptions = { url, persona: "bob", waitSeconds: 1,
    fetch: async (input, init) => {
      if (offline) throw new TypeError("test offline");
      const path = new URL(input).pathname;
      allRequests.push(path);
      if (scenario === "R2 sync during reply" && path === "/q/both") querySince = syncedAt;
      if (path === "/q/history") requests.push(JSON.parse(init.body).args.room);
      if (holdWrites && path.startsWith("/m/")) {
        if (eventCase) return Response.json({ denied: { code: "E_BUSY", family: "transport", message: "held for prediction", retryable: true } });
        throw new TypeError("write held for prediction");
      }
      if (path === "/sync" && interruptSnapshot) {
        if (snapshotStarted) throw new TypeError("interrupted mid-snapshot");
        init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), ...(scenario === "MQ retained snapshot" ? { from: 0, stream: false, after: null } : {}), limit: 2 }) };
      }
      const response = await fetch(input, init);
      if (path === "/sync") {
        const page = await response.clone().json(); syncPages.push(page);
        if (interruptSnapshot && page.snapshot && page.more) snapshotStarted = true;
      }
      if (intercept && path === `/q/${delayedName}`) await intercept(init);
      return response;
    },
    device: { open: async (...args) => { core = await opener.open(...args); return { close: () => core.close(), call: async (request) => { if (request.op === "set_meta" && request.key === "syncedAt") syncedAt = Number(request.value); if (request.op === "query" && deviceNow !== undefined) request = { ...request, now: deviceNow }; const reply = await core.call(request); if (request.op === "query") allAnswers.push({ name: request.name, ...reply.ok }); if (request.op === "query" && request.name === "history") deviceAnswers.push({ room: request.args.room, ...reply.ok }); if (interceptDevice) await interceptDevice(request, reply); return reply; } }; } },
  };
  if (session) { delete clientOptions.persona; clientOptions.session = session; }
  client = await createLocalClient(clientOptions);
  await client.sync();
  const held = await client.query(query, { room: "held" });
  assert.equal(held.data.length, 26); assert.equal(held.complete, true);
  if (!horizonFree) {
    assert.ok(requests.includes("held"));
    assert.ok(deviceAnswers.some((a) => a.room === "held" && a.data?.length === 25 && a.complete === false));
  }
  const watch = client.observe(query, { room: "left" });
  const deliveries = [];
  const unsubscribe = watch.subscribe(() => { const value = watch.getSnapshot(); if (value.data) deliveries.push(value.data.length); });
  t.after(() => { unsubscribe(); watch.close(); });
  await until(() => watch.getSnapshot().data?.length === 26, "held watch missing");
  assert.equal((await post("/m/leave", { args: { room: "left" }, id: "leave-left" })).state, "sent");
  await client.sync();
  const expected = (room, start) => rows.filter((item) => item.table === "messages" && item.row.room === room && item.row.at >= start).map((item) => item.row).reverse();
  if (permitCase || scenario.startsWith("MQ expiry local")) {
    // Keep both one-shot and watch coverage. The first device evaluation is
    // before the deadline; only its reply/outbox delivery crosses that deadline.
    unsubscribe(); watch.close(); offline = true; await client.sync();
    const observing = scenario.includes("watch");
    const op = { kind: "query", name: permitCase ? "permitBoth" : "both" };
    const deadline = permitCase ? permitDeadline : rows.find(item => item.row.id === "left-25").row.expiresAt;
    let now = deadline - 1;
    t.mock.method(Date, "now", () => now);
    const before = await client.query(op, {});
    const beforeData = permitCase
      ? { left: expected("left", 1), right: expected("held", 1), secret: { id: "secret", room: "vault", body: "private" } }
      : { left: expected("left", 1), held: expected("held", 1) };
    assert.deepEqual(before.data, beforeData);
    assert.equal(before.complete, false);
    let reached, queryCalls = 0, evaluated = false;
    const waiting = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { releaseReply = resolve; });
    interceptDevice = async (request, reply) => {
      if (request.op === "query" && request.name === op.name) {
        queryCalls++;
        if (queryCalls === 1) {
          assert.equal(request.now, deadline - 1, "the engine clock must still precede the deadline on the first call");
          assert.equal(reply.ok.nextExpiry, deadline);
          assert.equal(reply.ok.speculative, false);
          assert.equal(reply.ok.components.left.retained, true);
          assert.deepEqual(reply.ok.data, beforeData, "the first snapshot really contains the expiring row or authorized secret");
          if (permitCase) evaluated = true;
          else { reached(); await gate; }
        } else {
          assert.equal(request.now, deadline, "the retry must use the current clock");
        }
      }
      if (permitCase && request.op === "queued" && evaluated) {
        evaluated = false; reached(); await gate;
      }
    };
    let pending, live, stop;
    const publications = [];
    if (observing) {
      live = client.observe(op, {});
      pending = new Promise(resolve => {
        stop = live.subscribe(() => {
          const read = live.getSnapshot(); publications.push(read); resolve(read);
        });
      });
      t.after(() => { stop(); live.close(); });
    } else pending = client.query(op, {});
    await waiting; now = deadline; releaseReply();
    const result = await pending;
    const afterData = permitCase
      ? { ...beforeData, secret: null }
      : { ...beforeData, left: beforeData.left.slice(1) };
    assert.deepEqual(result.data, afterData, "the first post-deadline publication must recover live rows without publishing an expired snapshot or getting stuck loading");
    assert.equal(result.complete, false); assert.equal(result.fresh, false);
    assert.equal(queryCalls, 2, "exactly one local retry, without a server request or an intermediate loading publication");
    const raw = allAnswers.findLast(answer => answer.name === op.name);
    assert.equal(raw.nextExpiry, permitCase ? null : deadline + 86_400_000);
    if (observing) {
      assert.deepEqual(live.getSnapshot().data, afterData);
      assert.ok(publications.length > 0);
      for (const read of publications) assert.deepEqual(read.data, afterData, "even a transient expired watch snapshot is forbidden");
    }
    if (permitCase) assert.equal(result.data.secret, null);
    else assert.equal(result.data.left.length, 24);
    return;
  }
  if (eventCase) {
    for (const name of ["home", "homePage"]) {
      const before = await client.query({ kind: "query", name }, {});
      // The compiler conservatively gives a two-read filtered field no plan;
      // homePage is the independent one-read-per-field composition control.
      assert.deepEqual(before.data.older, name === "home" ? [] : expected("left", 1));
      assert.ok(before.data.events.some(row => name === "home" ? row.postId === "p3" : row.id === "gate"));
    }
    for (const fenced of [false, true]) {
      if (fenced) {
        offline = false; await client.sync(); holdWrites = true;
        const receipt = await client.mutate({ kind: "mutation", name: "post" }, { postId: "own-home", parentId: null });
        assert.equal(receipt.state, "pending");
        assert.equal((await client.mutate({ kind: "mutation", name: "send" }, { room: "held", at: 27, body: "predicted" })).state, "pending");
        assert.ok((await core.call({ op: "queued" })).ok.some(entry => entry.predictable && entry.observed_seq == null
          && entry.predicted.some(row => row.startsWith("feedPosts/"))));
      } else { offline = true; await client.sync(); }
      for (const name of ["home", "homePage"]) {
        const requestsBefore = allRequests.filter(path => path === `/q/${name}`).length;
        const answer = await client.query({ kind: "query", name }, {});
        if (name === "home" && !fenced) {
          assert.ok(answer.data.events.some(row => row.postId === "p3"), "an ineligible whole query recovers its server answer, never the empty placeholder");
          assert.equal(answer.fresh, false);
        } else assert.deepEqual(answer, { loading: true });
        assert.equal(allRequests.filter(path => path === `/q/${name}`).length, requestsBefore);
        const raw = allAnswers.findLast(answer => answer.name === name);
        assert.deepEqual(raw.data.older, expected("left", 1)); assert.deepEqual(raw.data.events, []);
        if (name === "homePage") {
          assert.equal(raw.components.older.retained, true); assert.equal(raw.components.events.speculative, true);
        } else assert.equal(raw.components, undefined, "cross-read filtered fields have no component plan");
        assert.equal(raw.loading, undefined, "the engine's available placeholder must still be withheld by rule 4");
      }
    }
    return;
  }
  if (scenario === "MQ speculative component") {
    const op = { kind: "query", name: "retainedPoint" };
    const online = await client.query(op, {});
    assert.deepEqual(online.data.left, expected("left", 1)); assert.equal(online.data.right.id, "held-0");
    const expectLocal = read => {
      assert.deepEqual(read, { loading: true }, "a speculative sibling cannot be data in an atomic Read<T>");
      const raw = allAnswers.findLast(answer => answer.name === "retainedPoint");
      assert.equal(raw.components.left.retained, true); assert.equal(raw.components.right.speculative, true);
    };
    offline = true; await client.sync();
    expectLocal(await client.query(op, {}));
    offline = false; await client.sync();
    intercept = async () => { throw new TypeError("failed speculative component transport"); };
    expectLocal(await client.query(op, {}));
    assert.equal(client.link(), "offline");
    return;
  }
  if (boundCase) {
    const name = "largeBoth", server = await post("/q/" + name, { args: {} }, "bob");
    assert.equal(server.denied.code, "E_BOUND", JSON.stringify(server));
    const read = await client.query({ kind: "query", name }, {});
    assert.deepEqual(read, { denied: server.denied }, "the original authoritative refusal must survive composition");
    const local = allAnswers.findLast(answer => answer.name === name);
    assert.equal(local.data.left.length, 25); assert.equal(local.data.right.length, 1);
    assert.equal(local.components.left.retained, true); assert.equal(local.components.right.unknown, true);
    assert.equal(local.loading, undefined);
    return;
  }
  if (wordCase) {
    const name = "wordBoth";
    const result = await client.query({ kind: "query", name }, {});
    const local = allAnswers.findLast(answer => answer.name === name);
    assert.deepEqual(local.components.left, { complete: true, unknown: false, retained: true, speculative: false });
    assert.equal(local.components.right.unknown, true, "the right horizon needs server knowledge");
    assert.ok(allRequests.includes("/q/wordBoth"), "mixed routing consulted the server");
    assert.deepEqual(result.data.left, horizonFree ? expected("left", 1) : true, "server fallback must keep the left group's delivered matching history");
    assert.deepEqual(result.data.right, expected("held", 0));
    assert.equal(result.complete, true);
    assert.equal(result.fresh, false);
    assert.ok(result.since > 0);
    t.diagnostic(`W14A ${tier}: acquired before leave; ${horizonFree ? "25 retained matches" : "positive retained existence"} + 26 server rows`);
    return;
  }
  if (scenario === "MQ points") {
    for (const name of ["pointMiss", "pointIndex", "pointId", "pointExists"]) {
      const result = await client.query({ kind: "query", name }, {});
      const local = allAnswers.findLast(answer => answer.name === name);
      const hit = name !== "pointMiss";
      assert.deepEqual(local.components.left, { complete: hit, unknown: !hit, retained: hit, speculative: !hit }, name);
      assert.deepEqual(result.data.held, expected("held", 0));
      assert.deepEqual(result.data.left, name === "pointMiss" ? null : name === "pointExists" ? true : rows.find(item => item.row.id === "left-25").row);
      assert.equal(result.complete, true);
      assert.equal(result.fresh, !hit);
    }
    return;
  }
  if (scenario === "MQ ineligible") {
    const eligible = await client.query({ kind: "query", name: "both" }, {});
    assert.deepEqual(Object.keys(allAnswers.findLast(answer => answer.name === "both").components).sort(), ["held", "left"]);
    assert.deepEqual(eligible.data, { left: expected("left", 1), held: expected("held", 0) });
    for (const name of ["heldBoth", "cursorBoth", "shared", "combined", "branch", "loop", "mixed"]) {
      const result = await client.query({ kind: "query", name }, {});
      assert.equal(allAnswers.findLast((answer) => answer.name === name).components, undefined, name);
      if (name === "heldBoth") assert.deepEqual(result.data, { left: expected("left", 1), held: expected("held", 1) });
      else if (name === "shared") assert.deepEqual(result.data, { left: expected("held", 0), held: expected("held", 0) });
      else if (name === "combined") assert.deepEqual(result.data, { total: 26, other: 0 });
      else if (name === "mixed") assert.deepEqual(result.data, expected("held", 0));
      else assert.deepEqual(result.data, { left: [], held: expected("held", 0) });
    }
    return;
  }
  if (scenario.startsWith("MQ ")) {
    const both = { kind: "query", name: delayedName };
    if (scenario.includes("current")) {
      const completeOnly = await client.query({ kind: "query", name: "completeOnly" }, {});
      assert.equal(completeOnly.fresh, true, "complete-only locals do not enter composition");
      assert.deepEqual(completeOnly.data.current, [rows.find(item => item.table === "current").row]);
      assert.deepEqual(completeOnly.data.held, expected("held", 0), "the server supplies all 26 held rows");
      assert.equal(allRequests.filter(path => path === "/q/completeOnly").length, 1);
    }
    assert.deepEqual((await client.query(both, {})).data.left, expected("left", 1));
    let release, entered;
    const waiting = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; releaseReply = resolve; });
    t.after(() => release());
    let delayedReplies = 0;
    intercept = async () => { delayedReplies++; entered(); await gate; if (scenario === "MQ transport") throw new TypeError("lost reply"); };
    const from = allRequests.filter((path) => path === `/q/${delayedName}`).length;
    const delayedWatch = client.observe(both, {});
    const publications = [], publicationReads = [];
    const stopWatch = delayedWatch.subscribe(() => { const value = delayedWatch.getSnapshot(); if (value.data) { publications.push(value.data); publicationReads.push(value); } });
    t.after(() => { stopWatch(); delayedWatch.close(); });
    const pending = client.query(both, {});
    await waiting;
    await until(() => delayedReplies >= 2, "query and watch must both reach the delay");
    let closing, predicted, oldToken;
    const initialStore = syncPages.at(-1).store_id;
    if (scenario === "MQ adoption") {
      writeFileSync(join(directory, "snapback/schema.q"), fixtureSource.replace("epoch: 1", "epoch: 2"));
      await until(async () => (await fetch(`${url}/schema`, { headers: { "x-snapback-persona": "bob" } }).then(r => r.json())).generation > 1, "server did not adopt");
      await client.sync();
      assert.equal(syncPages.at(-1).store_id, initialStore);
    } else if (scenario === "MQ reset" || scenario === "MQ interrupted snapshot") {
      offline = true;
      child.kill("SIGTERM"); await exit;
      const port = new URL(url).port;
      child = spawn(binary, ["dev", "--port", port, "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
      exit = once(child, "exit"); let started = "";
      child.stdout.on("data", data => { started += data; }); child.stderr.on("data", data => { started += data; });
      await until(() => started.includes(url), "replacement server did not start");
      const replacementRows = rows.map(item => item.table === "messages" ? { ...item, row: { ...item.row, body: "replacement" } } : item);
      assert.equal((await post("/seed", replacementRows)).seeded, rows.length);
      for (const room of ["left", "held", "current"]) assert.equal((await post("/m/join", { args: { room }, id: `replacement-${room}` })).state, "sent");
      interruptSnapshot = scenario === "MQ interrupted snapshot";
      offline = false; await client.sync();
      if (interruptSnapshot) { assert.equal(snapshotStarted, true); assert.equal(client.acquired, false); }
      else assert.equal(client.acquired, true);
      assert.notEqual(syncPages.at(-1).store_id, initialStore);
    } else if (scenario === "MQ retained snapshot") {
      interruptSnapshot = true; await client.sync();
      assert.equal(snapshotStarted, true);
      assert.equal(syncPages.at(-1).store_id, initialStore);
    } else if (scenario === "MQ rotation") {
      oldToken = client.session().token;
      assert.equal((await client.refreshSession()).ok, true);
      assert.notEqual(client.session().token, oldToken);
      assert.equal((await post("/m/send", { args: { room: "held", at: 27, body: "after rotation" }, id: "rotated-held" })).state, "sent");
      await client.sync();
    } else if (scenario === "MQ prediction") {
      holdWrites = true;
      predicted = await client.mutate({ kind: "mutation", name: "send" }, { room: "held", at: 27, body: "predicted" });
      assert.equal(predicted.state, "pending");
      assert.ok((await core.call({ op: "queued" })).ok.some(entry => entry.predictable));
    } else if (expiring) {
      const advanced = await post("/dev/clock/advance", { duration: "2h" });
      assert.equal(advanced.advancedMs, 7_200_000);
      deviceNow = Date.now() + 7_200_000;
      await client.sync();
    }
    if (scenario.includes("current")) {
      const path = scenario === "MQ delete current" ? "/m/removeCurrent" : "/m/leave";
      assert.equal((await post(path, { args: scenario === "MQ delete current" ? {} : { room: "current" }, id: "remove-current" })).state, "sent");
      await client.sync();
    } else if (scenario === "MQ rejoin") {
      assert.equal((await post("/m/join", { args: { room: "left" }, id: "rejoin-left" })).state, "sent");
      await client.sync();
    } else if (scenario === "MQ held change") {
      assert.equal((await post("/m/send", { args: { room: "held", at: 27, body: "new" }, id: "new-held" })).state, "sent");
      await client.sync();
    } else if (scenario === "MQ close") closing = client.close();
    else if (scenario === "MQ sign-out") closing = client.signOut();
    release();
    const result = await pending;
    if (["MQ reset", "MQ interrupted snapshot"].includes(scenario)) {
      assert.ok(result.data, JSON.stringify(result));
      assert.ok([...result.data.left, ...result.data.held].every(row => row.body === "replacement"), "no old store rows may publish");
      for (const data of publications) assert.ok([...data.left, ...data.held].every(row => row.body === "replacement"));
      interruptSnapshot = false; await client.sync();
      const recovered = await client.query(both, {});
      assert.equal(client.acquired, true); assert.equal(recovered.data.held.length, 26);
      assert.ok(recovered.data.held.every(row => row.body === "replacement"));
    } else if (scenario === "MQ retained snapshot") {
      assert.deepEqual(result.data, { left: expected("left", 1), held: expected("held", 0) });
      assert.equal(result.complete, false); assert.equal(result.fresh, false);
      interruptSnapshot = false; await client.sync();
      const recovered = await client.query(both, {});
      assert.deepEqual(recovered.data, { left: expected("left", 1), held: expected("held", 0) });
      assert.equal(recovered.complete, false);
    } else if (scenario === "MQ adoption") {
      assert.equal(result.data.epoch, 2);
      assert.deepEqual(result.data, { left: [], held: expected("held", 0), epoch: 2 }, "generation reset leaves the whole new server answer");
      assert.equal(result.complete, true); assert.equal(result.fresh, true);
      assert.ok(allRequests.filter(path => path === `/q/${delayedName}`).length >= from + 3, "old backend query must be retried");
    } else if (scenario === "MQ prediction") {
      assert.equal(result.complete, false);
      assert.deepEqual(result.data.left, expected("left", 1));
      assert.equal(result.data.held[0].pending, true);
      assert.equal(result.data.held[0].body, "predicted");
      holdWrites = false; await client.sync();
      await until(async () => !(await core.call({ op: "queued" })).ok.some(entry => entry.observed_seq == null), "prediction never settled");
      const settled = await client.query(both, {});
      assert.deepEqual(settled.data.left, expected("left", 1)); assert.equal(settled.complete, false);
      assert.equal(settled.data.held[0].body, "predicted"); assert.ok(!settled.data.held[0].pending);
    } else if (scenario === "MQ rotation") {
      assert.deepEqual(result.data.left, expected("left", 1)); assert.equal(result.complete, false);
      assert.equal(result.data.held[0].body, "after rotation", "query retries under the new bearer");
    } else if (expiring) {
      const left = expected("left", 1).filter(row => row.expiresAt > deviceNow);
      assert.deepEqual(result.data.left, left);
      assert.equal(result.complete, false);
      // Applied expiry withdrawals invalidate the old server transaction too.
      assert.deepEqual(result.data.held, expected("held", 0).filter(row => row.expiresAt > deviceNow));
      const refreshed = await client.query(both, {});
      assert.deepEqual(refreshed.data.left, left);
      assert.deepEqual(refreshed.data.held, expected("held", 0).filter(row => row.expiresAt > deviceNow));
      assert.equal(refreshed.complete, false);
    } else if (closing) { await closing; assert.equal(result.data, undefined, "closed identity must publish no rows"); assert.deepEqual(publications, [], "watch must publish nothing from the closed identity"); }
    else if (scenario === "MQ rejoin") assert.deepEqual(result.data.left, expected("left", 0), "the new authority requires a new server observation");
    else {
      assert.deepEqual(result.data.left, expected("left", 1));
      if (scenario === "MQ held change") {
        assert.equal(result.data.held[0].body, "new", "a horizon withdrawal fences the old server response");
        assert.deepEqual(result.data.held.slice(1), expected("held", 0));
      } else assert.deepEqual(result.data.held, expected("held", scenario === "MQ transport" ? 1 : 0));
      assert.equal(result.complete, false);
      assert.equal(result.fresh, false);
    }
    if (scenario.includes("current")) assert.deepEqual(result.data.current, [], "second local observes deletion or revocation");
    intercept = undefined;
    if (scenario === "MQ adoption") {
      await until(() => publications.length > 0, "watch must publish the new generation");
      for (const read of publicationReads) {
        assert.deepEqual(read.data, { left: [], held: expected("held", 0), epoch: 2 }, "no old-generation query or watch reply may publish");
        assert.equal(read.complete, true);
        if (!read.fresh) assert.ok(Number.isFinite(read.since), "a further fetch may bridge only the new generation's answer");
      }
      assert.ok(publicationReads.some(read => read.fresh), "the new generation's server answer was published");
    }
    if (!closing && !["MQ adoption", "MQ rejoin", "MQ reset", "MQ interrupted snapshot"].includes(scenario)) {
      await until(() => publications.length > 0, "watch must publish the composed observation");
      for (const read of publicationReads) assert.equal(read.complete, false, "watch cannot certify the undelivered left row");
      for (const data of publications) {
        assert.deepEqual(data.left, expected("left", 1).filter(row => !expiring || row.expiresAt > deviceNow), "every watch publication keeps all retained rows");
        if (scenario.includes("current")) assert.deepEqual(data.current, [], "watch must not resurrect removed rows");
      }
    }
    if (scenario === "MQ held change") assert.equal((await client.query(both, {})).data.held[0].body, "new");
    return;
  }
  if (scenario === "R2 sync during reply") {
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; releaseReply = resolve; });
    t.after(() => release());
    intercept = async () => { entered(); await gate; };
    const pending = client.query({ kind: "query", name: "both" }, {});
    await waiting;
    const before = querySince;
    assert.ok(Number.isInteger(before) && before > 0);
    await until(() => Date.now() > before, "clock must advance before the next sync");
    await client.sync();
    const after = Number((await core.call({ op: "meta", key: "syncedAt" })).ok);
    assert.ok(after > before, "a later sync completed while the server reply was delayed");
    release();
    const result = await pending;
    assert.deepEqual(result.data, { left: expected("left", 1), held: expected("held", 0) });
    assert.equal(result.fresh, false);
    assert.equal(result.complete, false);
    assert.equal(result.since, querySince, "composed since belongs to the replacement request after the commit fence");
    assert.ok(querySince >= after, "the sync commit discards and refetches the earlier HTTP response");
    return;
  }
  if (scenario === "R2 mixed result") {
    const both = { kind: "query", name: "both" };
    const online = await client.query(both, {});
    assert.equal(online.data.left.length, 25);
    assert.equal(online.data.held.length, 26);
    assert.equal(online.complete, false);
    assert.equal(online.fresh, false);
    // A composed read is as of the last sync: its retained components are, and its server components are newer.
    assert.ok(Number.isInteger(online.since) && online.since > 0 && online.since <= Date.now(), `since ${online.since}`);
    assert.equal(online.next, null);
    assert.ok(allRequests.includes("/q/both"));
    assert.ok(allAnswers.some((answer) => answer.name === "both" && answer.data?.left.length === 25 && answer.data?.held.length === 25 && answer.unknown === true && answer.retained === false));
    assert.deepEqual(online.data, { left: expected("left", 1), held: expected("held", 0) });
    const mixedWatch = client.observe(both, {});
    t.after(() => mixedWatch.close());
    const stop = mixedWatch.subscribe(() => {}); t.after(stop);
    await until(() => mixedWatch.getSnapshot().data?.held.length === 26, "mixed result watch must use the server online");
    assert.deepEqual(mixedWatch.getSnapshot().data, { left: expected("left", 1), held: expected("held", 0) });
    assert.equal(mixedWatch.getSnapshot().complete, false);
    assert.equal(mixedWatch.getSnapshot().fresh, false);
    assert.ok(Number.isInteger(mixedWatch.getSnapshot().since) && mixedWatch.getSnapshot().since <= Date.now(), 'a composed watch is as of the last sync');
    assert.equal(mixedWatch.getSnapshot().next, null);
    offline = true; await client.sync();
    const local = await client.query(both, {});
    assert.equal(local.data.left.length, 25);
    assert.equal(local.data.held.length, 25);
    assert.equal(local.complete, false);
    assert.deepEqual(local.data, { left: expected("left", 1), held: expected("held", 1) });
    await until(() => mixedWatch.getSnapshot().data?.left.length === 25 && mixedWatch.getSnapshot().fresh === false, "mixed result watch must use the device offline");
    assert.equal(mixedWatch.getSnapshot().data.held.length, 25);
    offline = false; await client.sync();
    await until(() => mixedWatch.getSnapshot().data?.held.length === 26, "mixed result watch must resume server fallback");
    assert.deepEqual(mixedWatch.getSnapshot().data, { left: expected("left", 1), held: expected("held", 0) });
    assert.equal(mixedWatch.getSnapshot().complete, false);
    assert.equal(mixedWatch.getSnapshot().fresh, false);
    assert.ok(Number.isInteger(mixedWatch.getSnapshot().since) && mixedWatch.getSnapshot().since <= Date.now(), 'a composed watch is as of the last sync');
    assert.equal(mixedWatch.getSnapshot().next, null);
    assert.equal((await client.query(query, { room: "left" })).data.length, 25, "keep retained history in its own query");
    offline = true;
    mixedWatch.close(); watch.close();
    await client.close();
    client = await createLocalClient(clientOptions);
    const reopened = await client.query(both, {});
    assert.deepEqual(reopened.data, { left: expected("left", 1), held: expected("held", 1) });
    assert.equal(reopened.complete, false);
    assert.equal(reopened.fresh, false);
    console.log(`R2 ${tier} mixed result: online left=25 held=26; offline/reopen left=25 held=25; separate left=25`);
    return;
  }
  if (scenario === "R1a empty search") {
    const search = { kind: "query", name: "search" };
    const heldSearch = await client.query(search, { room: "held", q: "needle" });
    assert.equal(heldSearch.data.length, 1, "held empty device search must fall back for the omitted oldest row");
    assert.equal(heldSearch.complete, true);
    const from = allRequests.length;
    const leftSearch = await client.query(search, { room: "left", q: "needle" });
    assert.deepEqual(leftSearch.data, []);
    assert.equal(leftSearch.complete, false);
    assert.ok(!allRequests.slice(from).includes("/q/search"), "left empty search remains a device answer");
    assert.equal((await client.query(search, { room: "left", q: "del" })).data.length, 25);
    console.log(`R1a ${tier} empty search: held=${heldSearch.data.length}, complete=${heldSearch.complete}; left=${leftSearch.data.length}, complete=${leftSearch.complete}`);
    return;
  }
  if (scenario === "R1a mixed reads") {
    const mixed = { kind: "query", name: "mixed" };
    const result = await client.query(mixed, {});
    assert.equal(result.data.length, 26, "an unrelated left read must not mask the held horizon");
    assert.equal(result.complete, true);
    assert.ok(allRequests.includes("/q/mixed"));
    assert.ok(allAnswers.some((answer) => answer.name === "mixed" && answer.data?.length === 25 && answer.unknown === true && answer.retained === false));
    const mixedWatch = client.observe(mixed, {});
    t.after(() => mixedWatch.close());
    const stop = mixedWatch.subscribe(() => {}); t.after(stop);
    await until(() => mixedWatch.getSnapshot().data?.length === 26, "mixed watch must fall back for held coverage");
    assert.equal((await client.query(query, { room: "left" })).data.length, 25);
    console.log(`R1a ${tier} mixed: device=25, server=${result.data.length}, watch=${mixedWatch.getSnapshot().data.length}`);
    return;
  }
  const left = await client.query(query, { room: "left" });
  console.log(`R5 ${tier} online left: rows=${left.data?.length}, complete=${left.complete}; held: rows=${held.data.length}, complete=${held.complete}`);
  assert.equal(left.data.length, 25, "online read must return retained history");
  assert.equal(left.complete, false);
  assert.ok(deviceAnswers.some((a) => a.room === "left" && a.retained === true && a.unknown === false));
  await until(() => watch.getSnapshot().data?.length === 25, "watch substituted revoked server answer");
  assert.equal(watch.getSnapshot().complete, false);
  const from = requests.length;
  await client.query(query, { room: "left" });
  await client.sync();
  assert.ok(!requests.slice(from).includes("left"), "left read/watch must not fall back");
  assert.equal((await client.query(query, { room: "held" })).data.length, 26);
  assert.ok(requests.slice(from).includes("held"));
  const across = await client.query({ kind: "query", name: "across" }, {});
  assert.ok(across.data.every((row) => row.room === "held"), "unscoped reads keep server fallback");
  offline = true; await client.sync();
  assert.equal((await client.query(query, { room: "left" })).data.length, 25);
  await until(() => watch.getSnapshot().fresh === false, "watch did not rerun offline");
  assert.equal(watch.getSnapshot().data.length, 25);
  offline = false; await client.sync();
  await until(() => watch.getSnapshot().fresh === true, "watch did not recover online");
  assert.equal(watch.getSnapshot().data.length, 25);
  assert.ok(deliveries.includes(25)); assert.ok(!deliveries.includes(0));
  assert.equal((await post("/q/history", { args: { room: "left" } }, "bob")).data.length, 0);
  console.log(`R5 ${tier} watch: rows=${watch.getSnapshot().data.length}, complete=${watch.getSnapshot().complete}; offline left: rows=25; revoked server: rows=0`);
});
