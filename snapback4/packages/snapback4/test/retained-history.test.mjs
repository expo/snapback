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
mutation join(room: text <=40):
  insert members {room, principal: 'dev:bob'}
mutation leave(room: text <=40):
  delete members[room = room, principal = 'dev:bob']
`;
for (const tier of ["wasm", "process"]) for (const scenario of ["R5 history", "R1a empty search", "R1a mixed reads", "R2 mixed result", "MQ ineligible", "MQ rejoin", "MQ held change", "MQ close", "MQ sign-out", "MQ transport"]) test(`${scenario} ${tier}: retained history and independent held coverage`, { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-retained-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(child, "exit");
  let log = "", url, client;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  t.after(async () => { await client?.close(); if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); await exit; });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
  const post = async (path, body, persona = "alice") => fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona }, body: JSON.stringify(body) }).then((r) => r.json());
  const rows = ["left", "held"].flatMap((room) => Array.from({ length: 26 }, (_, at) => ({ table: "messages", row: { id: `${room}-${at}`, room, at, body: at === 0 ? "needle" : "delivered" } })));
  rows.push(...["left", "held"].map((room) => ({ table: "members", row: { id: `alice-${room}`, room, principal: "dev:alice" } })));
  assert.equal((await post("/seed", rows)).seeded, 54);
  for (const room of ["left", "held"]) assert.equal((await post("/m/join", { args: { room }, id: `join-${room}` })).state, "sent");
  let offline = false, intercept;
  const requests = [], deviceAnswers = [], allRequests = [], allAnswers = [];
  const directoryDevice = join(directory, "device"); mkdirSync(directoryDevice);
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: directoryDevice, spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const clientOptions = { url, persona: "bob", waitSeconds: 1,
    fetch: async (input, init) => { if (offline) throw new TypeError("test offline"); allRequests.push(new URL(input).pathname); if (new URL(input).pathname === "/q/history") requests.push(JSON.parse(init.body).args.room); const response = await fetch(input, init); if (intercept && new URL(input).pathname === "/q/both") await intercept(); return response; },
    device: { open: async (...args) => { const core = await opener.open(...args); return { close: () => core.close(), call: async (request) => { const reply = await core.call(request); if (request.op === "query") allAnswers.push({ name: request.name, ...reply.ok }); if (request.op === "query" && request.name === "history") deviceAnswers.push({ room: request.args.room, ...reply.ok }); return reply; } }; } },
  };
  client = await createLocalClient(clientOptions);
  await client.sync();
  const held = await client.query(query, { room: "held" });
  assert.equal(held.data.length, 26); assert.equal(held.complete, true);
  assert.ok(requests.includes("held"));
  assert.ok(deviceAnswers.some((a) => a.room === "held" && a.data?.length === 25 && a.complete === false));
  const watch = client.observe(query, { room: "left" });
  const deliveries = [];
  const unsubscribe = watch.subscribe(() => { const value = watch.getSnapshot(); if (value.data) deliveries.push(value.data.length); });
  t.after(() => { unsubscribe(); watch.close(); });
  await until(() => watch.getSnapshot().data?.length === 26, "held watch missing");
  assert.equal((await post("/m/leave", { args: { room: "left" }, id: "leave-left" })).state, "sent");
  await client.sync();
  const expected = (room, start) => rows.filter((item) => item.table === "messages" && item.row.room === room && item.row.at >= start).map((item) => item.row).reverse();
  if (scenario === "MQ ineligible") {
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
    const both = { kind: "query", name: "both" };
    assert.deepEqual((await client.query(both, {})).data.left, expected("left", 1));
    let release, entered;
    const waiting = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    t.after(() => release());
    intercept = async () => { entered(); await gate; if (scenario === "MQ transport") throw new TypeError("lost reply"); };
    const from = allRequests.filter((path) => path === "/q/both").length;
    const delayedWatch = client.observe(both, {});
    const publications = [];
    const stopWatch = delayedWatch.subscribe(() => { const value = delayedWatch.getSnapshot(); if (value.data) publications.push(value.data); });
    t.after(() => { stopWatch(); delayedWatch.close(); });
    const pending = client.query(both, {});
    await waiting;
    await until(() => allRequests.filter((path) => path === "/q/both").length >= from + 2, "query and watch must both reach the delay");
    let closing;
    if (scenario === "MQ rejoin") {
      assert.equal((await post("/m/join", { args: { room: "left" }, id: "rejoin-left" })).state, "sent");
      await client.sync();
    } else if (scenario === "MQ held change") {
      assert.equal((await post("/m/send", { args: { room: "held", at: 27, body: "new" }, id: "new-held" })).state, "sent");
      await client.sync();
    } else if (scenario === "MQ close") closing = client.close();
    else if (scenario === "MQ sign-out") closing = client.signOut();
    release();
    const result = await pending;
    if (closing) { await closing; assert.equal(result.data, undefined, "closed identity must publish no rows"); assert.deepEqual(publications, [], "watch must publish nothing from the closed identity"); }
    else if (scenario === "MQ rejoin") assert.deepEqual(result.data.left, [], "the old server observation stands when no retained component remains");
    else {
      assert.deepEqual(result.data.left, expected("left", 1));
      assert.deepEqual(result.data.held, expected("held", scenario === "MQ transport" ? 1 : 0));
      assert.equal(result.complete, false);
      assert.equal(result.fresh, false);
    }
    intercept = undefined;
    if (!closing && scenario !== "MQ rejoin") {
      await until(() => publications.length > 0, "watch must publish the composed observation");
      for (const data of publications) assert.deepEqual(data.left, expected("left", 1), "every watch publication keeps all retained rows");
    }
    if (scenario === "MQ held change") assert.equal((await client.query(both, {})).data.held[0].body, "new");
    return;
  }
  if (scenario === "R2 mixed result") {
    const both = { kind: "query", name: "both" };
    const online = await client.query(both, {});
    assert.equal(online.data.left.length, 25);
    assert.equal(online.data.held.length, 26);
    assert.equal(online.complete, false);
    assert.equal(online.fresh, false);
    assert.equal(online.since, undefined);
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
    assert.equal(mixedWatch.getSnapshot().since, undefined);
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
    assert.equal(mixedWatch.getSnapshot().since, undefined);
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
