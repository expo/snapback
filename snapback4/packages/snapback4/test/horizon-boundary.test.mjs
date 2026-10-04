import { captureStdout } from './helpers/server-output.mjs';
import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const publicSource = readFileSync(join(root, "../benchmarks/runs/2026-09-17-snapback4-derived-probes/horizon-gap/snapback/schema.q"), "utf8");
const groupSource = `use personas alice, bob
table members:
  conversation: text <=10
  person: principal
  unique byConversationPerson: conversation, person
  by byPerson: person, conversation
  immutable conversation, person
  read <- .person = viewer
  insert <- deny
  online only
table messages:
  conversation: text <=10
  ordinal: int
  body: text <=40
  by byConversationOrdinal: conversation, ordinal, id
  immutable conversation, ordinal
  read <- exists members[.conversation, viewer]
  update <- allow
  sync to members[.conversation] last 5 by byConversationOrdinal
query timeline(c: cursor ?):
  return messages['g'] after c last 3 by byConversationOrdinal { id, body }
mutation edit(p: messages):
  update messages[p] {body: 'edited'}
`;
const ids = read => read.data.map(row => row.id);
for (const group of [false, true]) test(`wasm acquisition boundary: ${group ? "conversation ordinal" : "public timeline"}`, { timeout: hangBudget(5000) }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-horizon-boundary-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), group ? groupSource : publicSource);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(server);
  const exited = once(server, "exit");
  let log = "", client;
  server.stderr.on("data", chunk => { log += chunk; });
  t.after(async () => { await client?.close(); if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; rmSync(directory, { recursive: true, force: true }); });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in ten minutes: ${log}`)), hangBudget());
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
    server.stdout.on("data", chunk => { log += chunk; const found = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/); if (found) { clearTimeout(timer); resolve(found[0]); } });
  });
  const post = async (path, body, persona = "bob") => {
    const reply = await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await reply.json(); assert.equal(reply.status, 200, JSON.stringify(result)); return result;
  };
  const prefix = group ? "m" : "p";
  const rows = Array.from({ length: 12 }, (_, i) => ({ table: group ? "messages" : "posts", row: group
    ? { id: `m${String(i + 1).padStart(2, "0")}`, conversation: "g", ordinal: i + 1, body: "original" }
    : { id: `p${String(i + 1).padStart(2, "0")}`, authorId: "dev:alice", body: "post", at: (i + 1) * 1000, score: 0 } }));
  if (group) rows.push({ table: "members", row: { id: "member", conversation: "g", person: "dev:bob" } });
  assert.equal((await post("/seed", rows)).seeded, rows.length);
  const observed = [], pages = [];
  const opener = webDevice({ wasm, persist: memoryPersistence() });
  client = await createLocalClient({ url, persona: "bob", waitSeconds: 1,
    device: { open: async (...args) => {
      const core = await opener.open(...args);
      return { close: () => core.close(), call: async request => {
        const reply = await core.call(request);
        if (request.op === "query") observed.push({ args: request.args, ...reply.ok });
        if (request.op === "apply") pages.push(request.page);
        return reply;
      } };
    } },
  });
  const walk = async () => {
    const answers = []; let cursor = null;
    for (let i = 0; i < 3; i++) {
      const result = await client.query({ kind: "query", name: "timeline" }, { c: cursor });
      assert.ok(result.data); answers.push(result); cursor = result.next;
    }
    return answers;
  };
  const control = await walk();
  assert.deepEqual(control.map(ids), [[12, 11, 10], [9, 8, 7], [6, 5, 4]].map(page => page.map(n => `${prefix}${String(n).padStart(2, "0")}`)));
  observed.length = 0;
  for (const n of [2, 4]) {
    const p = `${prefix}${String(n).padStart(2, "0")}`;
    const result = await post(group ? "/m/edit" : "/m/like", { id: `change-${p}`, args: group ? { p } : { postId: p } }, "alice");
    assert.equal(result.state, "sent");
  }
  await client.sync();
  const after = await walk();
  let cursor = null;
  for (let i = 0; i < 3; i++) {
    const serverPage = await post("/q/timeline", { args: { c: cursor } });
    assert.deepEqual(after[i].data, serverPage.data, `page ${i + 1} matches server`);
    assert.equal(after[i].complete, true); assert.equal(after[i].next, serverPage.next);
    cursor = serverPage.next;
  }
  const localCrossing = observed.find(read => read.args.c === control[0].next);
  assert.equal(localCrossing.complete, false); assert.equal(localCrossing.unknown, true);
  assert.deepEqual(ids(localCrossing), [`${prefix}09`, `${prefix}08`]);
  assert.ok(pages.some(page => page.acquisitions?.some(marker => marker.floor && marker.floor !== "whole")));
  assert.deepEqual(after.map(ids), control.map(ids), "m07 m06 m05 are never skipped");
});

const rawBackend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const message = n => ({ table: "messages", id: `p${n}`, kind: "put", data: { id: `p${n}`, conversationId: "c1", authorId: "dev:alice", body: `p${n}`, at: n * 1000, editedAt: null, photo: null } });
const membership = { table: "memberships", id: "m", kind: "put", data: { id: "m", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } };
const marker = (at, floor) => ({ at, table: "messages", index: "byConvTime", group: ["c1"], ...(floor ? { floor } : {}) });
const rawQuery = core => core.call({ op: "query", name: "thread", viewer: "dev:alice", args: { conversationId: "c1", c: null }, now: 20_000 });

test("wasm rejects a skipped snapshot page before accepting its completion", async t => {
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist });
  const core = await opener.open("skip", rawBackend); t.after(() => core.close());
  const pages = [
    { after: null, next: "middle", more: true, events: [membership, message(12), message(11)], acquisitions: [marker(1)] },
    { after: "middle", next: "last", more: true, events: [message(10), message(9)] },
    { after: "last", next: null, more: false, events: [message(8)], acquisitions: [marker(1, "whole")] },
  ].map(page => ({ snapshot: true, stage_snapshot: true, generation: 1, watermark: 1, ...page }));
  ok(await core.call({ op: "apply", first: true, page: pages[0] }));
  const before = await persist.load("skip");
  const skipped = await core.call({ op: "apply", page: pages[2] });
  assert.equal(skipped.denied?.message, "E_GENERATION: snapshot continuation does not match the expected page; restart at its first page");
  assert.deepEqual(await persist.load("skip"), before, "refusal writes no rows or completions");
  const catchup = { snapshot: false, snapshot_catchup: true, events: [], watermark: 1, more: false };
  assert.equal((await core.call({ op: "apply", page: catchup })).denied?.message, "E_GENERATION: snapshot catch-up requires the terminal snapshot page");
  for (const page of pages.slice(1)) ok(await core.call({ op: "apply", page }));
  ok(await core.call({ op: "apply", page: catchup }));
  const read = ok(await rawQuery(core));
  assert.equal(read.complete, true); assert.deepEqual(ids(read), [12, 11, 10, 9, 8].map(n => `p${n}`));
});

for (const moved of [false, true]) test(`wasm retained reacquisition remains unknown after gap ${moved ? "move" : "deletion"}`, async t => {
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist });
  let core = await opener.open(`gap-${moved}`, rawBackend); t.after(() => core.close());
  ok(await core.call({ op: "apply", first: true, page: { snapshot: true, events: [membership, message(2), message(1)], acquisitions: [marker(1), marker(3, "whole")], watermark: 1, more: false } }));
  assert.equal(ok(await rawQuery(core)).complete, true);
  ok(await core.call({ op: "apply", page: { snapshot: false, events: [{ table: "messages", id: "scope", kind: "scope", data: ["c1"] }], watermark: 2, more: false } }));
  const rows = moved ? [message(6), message(5), message(4), message(3), message(1)] : [message(1)];
  ok(await core.call({ op: "apply", page: { snapshot: false, events: rows, acquisitions: [marker(0), marker(rows.length, "whole")], joined: { messages: [["c1"]] }, watermark: 4, more: false } }));
  assert.equal(ok(await rawQuery(core)).unknown, true);
  await core.close(); core = await opener.open(`gap-${moved}`);
  const retained = ok(await rawQuery(core)); assert.equal(retained.unknown, true); assert.equal(retained.complete, false); assert.ok(ids(retained).includes("p2"));
  ok(await core.call({ op: "apply", first: true, page: { snapshot: true, held: { messages: [["c1"]] }, events: [membership, ...rows], acquisitions: [marker(1), marker(rows.length + 1, "whole")], watermark: 4, more: false } }));
  const refreshed = ok(await rawQuery(core)); assert.equal(refreshed.complete, true); assert.equal(refreshed.unknown, false); assert.deepEqual(ids(refreshed), rows.map(row => row.id));
});

const reviewSource = `use personas alice, bob
table members:
  group: text <=440
  person: principal
  unique byGroupPerson: group, person
  by byPerson: person, group
  immutable group, person
  read <- .person = viewer
  insert <- deny
  online only
table posts:
  group: text <=440
  at: time
  by byTime: group, at, id
  read <- exists members[.group, viewer]
  update <- allow
  delete <- allow
  sync to members[.group] last 2 by byTime
query timeline(g: text <=440, c: cursor ?):
  return posts[g] after c last 2 by byTime { id, at }
mutation remove(p: posts):
  delete posts[p]
mutation hide(p: posts):
  update posts[p] {group: 'secret'}
mutation move(p: posts, at: time):
  update posts[p] {at}
query newest(c: cursor ?):
  return posts['g'] after c last 1 by byTime { id, at }
query above(c: cursor ?):
  return posts['g', at >= 2500] after c last 2 by byTime { id, at }
`;
async function reviewServer(t, source = reviewSource) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-boundary-review-"));
  mkdirSync(join(directory, "snapback")); writeFileSync(join(directory, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(server);
  const exited = once(server, "exit"); let log = "";
  server.stderr.on("data", chunk => { log += chunk; });
  t.after(async () => { if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; rmSync(directory, { recursive: true, force: true }); });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log)), hangBudget());
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
    server.stdout.on("data", chunk => { log += chunk; const found = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/); if (found) { clearTimeout(timer); resolve(found[0]); } });
  });
  const post = async (path, body, persona = "bob") => {
    const started = Date.now();
    const response = await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); assert.ok(!result.denied, JSON.stringify(result));
    if (path === "/sync") {
      assert.ok(Number.isSafeInteger(result.now), "sync carries its pinned clock");
      assert.ok(result.now >= started - 1000 && result.now <= Date.now() + 1000, "sync clock belongs to this request, never to a private row");
    }
    return result;
  };
  const backend = await (await fetch(`${url}/schema`, { headers: { "x-snapback-persona": "bob" } })).json();
  const persist = memoryPersistence();
  const core = await webDevice({ wasm, persist }).open(directory, backend); t.after(() => core.close());
  return { post, core, persisted: () => persist.load(directory) };
}
for (const moved of [false, true]) for (const hidden of [false, true]) test(`wasm wire withholds a ${hidden ? "hidden" : "deleted"} floor's historical value${moved ? " with moved survivor (recheck)" : ""}`, { timeout: hangBudget(5000) }, async t => {
  const payloads = [];
  for (const at of [800, 2000]) {
    const { post, core } = await reviewServer(t);
    await post("/seed", [100, at, 3000].map((at, i) => ({ table: "posts", row: { id: `p${i + 1}`, group: "g", at } })));
    const before = await post("/sync", { from: 0 }); ok(await core.call({ op: "apply", first: true, page: before }));
    await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
    assert.equal((await post(`/m/${hidden ? "hide" : "remove"}`, { id: "withhold", args: { p: "p2" } })).state, "sent");
    if (moved) assert.equal((await post("/m/move", { id: "move", args: { p: "p3", at: 1000 } })).state, "sent");
    const stream = await post("/sync", { from: before.watermark, stream: true });
    const { store_id, now, ...payload } = stream; payloads.push(JSON.stringify(payload));
    ok(await core.call({ op: "apply", page: stream }));
    const read = ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: 20_000 }));
    assert.deepEqual(ids(read), ["p3", "p1"]); assert.equal(read.unknown, false); assert.equal(read.complete, true);
  }
  assert.equal(payloads[0], payloads[1], "all viewer payload bytes agree apart from independent store identity and validated request time");
  if (moved) {
    assert.equal(JSON.parse(payloads[0]).acquisitions.filter(a => a.floor).length, 1);
    console.log(`wasm moved survivor hidden=${hidden}: payload-bytes=${Buffer.byteLength(payloads[0])} identical-worlds=2 completions=1 key-at=100`);
  }
});

for (const removed of [false, true]) test(`wasm recheck unselected row ${removed ? "replaces a deleted selection" : "enters the current top two"}`, { timeout: hangBudget(5000) }, async t => {
  const { post, core } = await reviewServer(t);
  await post("/seed", [1500, 2000, 3000].map((at, i) => ({ table: "posts", row: { id: `p${i + 1}`, group: "g", at } })));
  const before = await post("/sync", { from: 0 }); ok(await core.call({ op: "apply", first: true, page: before }));
  await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
  assert.equal((await post("/m/move", { id: "move", args: { p: "p3", at: 1000 } })).state, "sent");
  if (removed) assert.equal((await post("/m/remove", { id: "remove", args: { p: "p2" } })).state, "sent");
  const stream = await post("/sync", { from: before.watermark, stream: true });
  const floors = stream.acquisitions.filter(a => a.floor).map(a => a.floor);
  const snapshot = await post("/sync", { from: 0 });
  assert.deepEqual(snapshot.events.filter(e => e.table === "posts").map(e => e.data.at), removed ? [1500, 1000] : [2000, 1500]);
  assert.deepEqual(floors, snapshot.acquisitions.filter(a => a.floor).map(a => a.floor));
  ok(await core.call({ op: "apply", page: stream }));
  for (const name of ["newest", "above"]) {
    const read = ok(await core.call({ op: "query", name, viewer: "dev:bob", args: { c: null }, now: 20_000 }));
    assert.equal(read.complete, true); assert.equal(read.unknown, false);
  }
  const crossing = ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: 20_000 }));
  assert.equal(crossing.complete, true); assert.equal(crossing.unknown, false); assert.deepEqual(ids(crossing), removed ? ["p1", "p3"] : ["p2", "p1"]);
  console.log(`wasm unselected control removed=${removed}: completions=${floors.length} key-at=${removed ? "1000" : "1500"} page-complete=true`);
});

test("wasm acquires 5000 empty groups through bounded HTTP pages", { timeout: hangBudget(5000) }, async t => {
  const { post, core } = await reviewServer(t);
  for (let n = 0; n < 5000; n += 100) {
    await post("/seed", Array.from({ length: 100 }, (_, i) => ({ table: "members", row: { id: `m${n + i}`, person: "dev:bob", group: `${String(n + i).padStart(4, "0")}${"😀".repeat(430)}` } })));
  }
  let after, pages = 0, groups = 0, watermark, maxBytes = 0;
  do {
    const limit = pages ? 32 : 1;
    const page = await post("/sync", { from: 0, after, limit });
    assert.equal(page.after ?? undefined, after); assert.equal(page.events.length, 0);
    assert.ok(page.acquisitions.length <= limit * 2); assert.ok(page.acquisitions.length > 0);
    groups += page.acquisitions.filter(m => m.floor === "whole").length;
    maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(page)));
    ok(await core.call({ op: "apply", first: pages === 0, page: { ...page, stage_snapshot: true } }));
    after = page.next; watermark = page.watermark; pages++;
  } while (after);
  const catchup = await post("/sync", { from: watermark, stream: true });
  ok(await core.call({ op: "apply", page: { ...catchup, snapshot_catchup: true } }));
  assert.equal(groups, 5000); assert.equal(pages, 158); assert.ok(maxBytes < 16 * 1024 * 1024);
  console.log(`wasm empty groups: groups=${groups} pages=${pages} max-response-bytes=${maxBytes}`);
});

for (const roundTrip of [true, false]) test(`wasm written unselected ${roundTrip ? "round trip hides pre-join key" : "same-key rewrite duplicates current acquisition"}`, { timeout: hangBudget(5000) }, async t => {
  const payloads = [], floors = [], reads = [], expected = [];
  for (const at of roundTrip ? [1500, 1200] : [1500]) {
    const { post, core } = await reviewServer(t);
    await post("/seed", [at, 2000, 3000].map((at, i) => ({ table: "posts", row: { id: `p${i + 1}`, group: "g", at } })));
    const before = await post("/sync", { from: 0 }); ok(await core.call({ op: "apply", first: true, page: before }));
    await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
    assert.equal((await post("/m/remove", { id: "remove-p2", args: { p: "p2" } })).state, "sent");
    assert.equal((await post("/m/move", { id: "move-p3", args: { p: "p3", at: 1000 } })).state, "sent");
    if (roundTrip) assert.equal((await post("/m/move", { id: "move-p1-away", args: { p: "p1", at: 1700 } })).state, "sent");
    assert.equal((await post("/m/move", { id: "write-p1", args: { p: "p1", at: 1500 } })).state, "sent");
    const stream = await post("/sync", { from: before.watermark, stream: true });
    const puts = stream.events.filter(e => e.id === "p1" && e.kind === "put");
    assert.equal(puts.length, roundTrip ? 3 : 2, "acquisition plus each later put");
    assert.ok(puts.every(e => e.data.at === 1500), "every put substitutes the current image");
    const { store_id, now, ...payload } = stream; payloads.push(JSON.stringify(payload));
    floors.push(stream.acquisitions.filter(a => a.floor).map(a => a.floor));
    // A fresh snapshot independently establishes the expected current p3 floor.
    const snapshot = await post("/sync", { from: 0 });
    assert.deepEqual(snapshot.events.filter(e => e.table === "posts").map(e => e.data.at), [1500, 1000]);
    expected.push(snapshot.acquisitions.filter(a => a.floor).map(a => a.floor));
    ok(await core.call({ op: "apply", page: stream }));
    reads.push(ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: 20_000 })));
  }
  if (roundTrip) assert.equal(payloads[0], payloads[1], "all payload bytes, markers included, agree apart from independent store identity");
  for (let i = 0; i < floors.length; i++) { assert.equal(expected[i].length, 1); assert.deepEqual(floors[i], expected[i]); }
  for (const read of reads) {
    assert.deepEqual(read.data, [{ id: "p1", at: 1500 }, { id: "p3", at: 1000 }]);
    assert.equal(read.complete, true); assert.equal(read.unknown, false);
  }
  console.log(`wasm written unselected round-trip=${roundTrip}: payload-bytes=${Buffer.byteLength(payloads[0])} worlds=${payloads.length} p1-puts=${roundTrip ? 3 : 2} completions=1 key-at=1000`);
});

for (const kind of ["scope", "join"]) for (const rowEvent of [null, "put", "del"]) test(`wasm membership collision ${kind} row-event=${rowEvent}`, { timeout: hangBudget(5000) }, async t => {
  const collision = JSON.stringify([{ String: "g" }]);
  const payloads = [], floors = [], reads = [], expected = [];
  const source = reviewSource.replace("use personas alice, bob", "use personas alice, bob, charlie")
    .replace("  insert <- deny", "  insert <- deny\n  delete <- allow") + "\nmutation leaveCharlie():\n  delete members['mc']\n";
  for (const group of ["g", "h"]) {
    const { post, core } = await reviewServer(t, source);
    const charlie = { table: "members", row: { id: "mc", group, person: "dev:charlie" } };
    const rows = [1500, 2000, 3000].map((at, i) => ({ table: "posts", row: { id: i ? `p${i + 1}` : collision, group: "g", at } }));
    if (kind === "scope") rows.push(charlie);
    await post("/seed", rows);
    const before = await post("/sync", { from: 0 }); ok(await core.call({ op: "apply", first: true, page: before }));
    await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
    assert.equal((await post("/m/move", { id: "move-p3", args: { p: "p3", at: 1000 } })).state, "sent");
    if (kind === "scope") assert.equal((await post("/m/leaveCharlie", { id: "leave-charlie", args: {} }, "charlie")).state, "sent");
    else await post("/seed", [charlie]);
    if (rowEvent) assert.equal((await post(`/m/${rowEvent === "put" ? "move" : "remove"}`, {
      id: "write-collision", args: rowEvent === "put" ? { p: collision, at: 1500 } : { p: collision },
    })).state, "sent");
    const stream = await post("/sync", { from: before.watermark, stream: true });
    assert.ok(stream.events.every(e => e.table === "posts" && ["put", "del"].includes(e.kind)), "private membership events never reach Bob");
    const colliding = stream.events.filter(e => e.id === collision);
    assert.equal(colliding.length, rowEvent === "put" ? 2 : 1);
    assert.equal(colliding.at(-1).kind, rowEvent ?? "put");
    assert.deepEqual(stream.events.filter(e => e.kind === "put" && e.id !== collision).map(e => e.id), rowEvent === "del" ? ["p2", "p3", "p3"] : ["p2", "p3"]);
    const { store_id, now, ...payload } = stream; payloads.push(JSON.stringify(payload));
    floors.push(stream.acquisitions.filter(a => a.floor).map(a => a.floor));
    const truth = await post("/q/timeline", { args: { g: "g", c: null } });
    assert.deepEqual(truth.data, [{ id: "p2", at: 2000 }, rowEvent === "del" ? { id: "p3", at: 1000 } : { id: collision, at: 1500 }]);
    ok(await core.call({ op: "apply", page: stream }));
    reads.push(ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: 20_000 })));
    const snapshot = await post("/sync", { from: 0 });
    assert.deepEqual(snapshot.events.filter(e => e.table === "posts").map(e => e.data.at), rowEvent === "del" ? [2000, 1000] : [2000, 1500]);
    expected.push(snapshot.acquisitions.filter(a => a.floor).map(a => a.floor));
  }
  assert.equal(payloads[0], payloads[1], "all payload bytes, markers included, agree apart from independent store identity");
  for (let i = 0; i < floors.length; i++) { assert.equal(expected[i].length, 1); assert.deepEqual(floors[i], expected[i]); }
  for (const read of reads) {
    const second = rowEvent !== "del" ? { id: collision, at: 1500 } : { id: "p3", at: 1000 };
    assert.deepEqual(read.data, [{ id: "p2", at: 2000 }, second]);
    assert.equal(read.complete, true); assert.equal(read.unknown, false);
  }
  console.log(`wasm membership collision kind=${kind} row-event=${rowEvent}: payload-bytes=${Buffer.byteLength(payloads[0])} identical-worlds=2 completions=1 key-at=${rowEvent === "del" ? 1000 : 1500}`);
});

for (const retained of [false, true]) for (const staged of [false, true]) test(`wasm current acquisition survives paged duplicates and later row changes staged=${staged} retained=${retained}`, { timeout: hangBudget(5000) }, async t => {
  const source = reviewSource.replace("  sync to members", `${retained ? "  retain delivered-history\n" : ""}  sync to members`).replace("  at: time", "  at: time\n  until: time ?\n  expire at .until\n  by byExpiry: until")
    + "\nmutation expire(p: posts):\n  update posts[p] {until: 1}\nquery one(p: posts):\n  return posts[p]\n";
  for (const change of ["below", "delete", "group", "expiry"]) {
    const { post, core } = await reviewServer(t, source);
    await post("/seed", [1000, 2000, 3000].map((at, i) => ({ table: "posts", row: { id: `p${i + 1}`, group: "g", at } })));
    const before = await post("/sync", { from: 0 });
    ok(await core.call({ op: "apply", first: true, page: { ...before, stage_snapshot: staged } }));
    await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
    await post("/seed", [{ table: "posts", row: { id: "p4", group: "g", at: 4000 } }]);
    const first = await post("/sync", { from: before.watermark, stream: true, limit: 1 });
    assert.equal(first.more, true); assert.deepEqual(first.events.map(e => e.id), ["p4", "p3"]);
    const snapshot = await post("/sync", { from: 0 });
    assert.deepEqual(first.acquisitions.filter(a => a.floor).map(a => a.floor), snapshot.acquisitions.filter(a => a.floor).map(a => a.floor));
    ok(await core.call({ op: "apply", page: { ...first, snapshot_catchup: staged } }));
    const duplicate = await post("/sync", { from: first.watermark, stream: true, limit: 1 });
    assert.deepEqual(duplicate.events.map(e => e.id), ["p4"]);
    ok(await core.call({ op: "apply", page: { ...duplicate, snapshot_catchup: staged } }));
    const query = () => core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: Date.now() });
    assert.deepEqual(ids(ok(await query())), ["p4", "p3"]);
    const op = { below: "move", delete: "remove", group: "hide", expiry: "expire" }[change];
    assert.equal((await post(`/m/${op}`, { id: "change", args: { p: "p4", ...(change === "below" ? { at: 500 } : {}) } })).state, "sent");
    const next = await post("/sync", { from: duplicate.watermark, stream: true });
    ok(await core.call({ op: "apply", page: next }));
    const one = ok(await core.call({ op: "query", name: "one", viewer: "dev:bob", args: { p: "p4" }, now: Date.now() }));
    if (change === "below") assert.equal(one.data.at, 500); else assert.equal(one.data, null);
    assert.deepEqual(ids(ok(await query())), ["p3"]);
  }
});

test("wasm horizonless current join and closed private join", { timeout: hangBudget(5000) }, async t => {
  const source = reviewSource.replace(" last 2 by byTime\nquery", "\nquery")
    .replace("  insert <- deny\n  online only", "  insert <- deny\n  delete <- allow\n  online only")
    .replace("  sync to members", "  retain delivered-history\n  sync to members")
    + "\nmutation leave():\n  delete members['m']\n";
  for (const leave of [false, true]) {
    const { post, core } = await reviewServer(t, source);
    await post("/seed", Array.from({ length: 26 }, (_, i) => ({ table: "posts", row: { id: `p${i}`, group: "g", at: i } })));
    const before = await post("/sync", { from: 0 }); ok(await core.call({ op: "apply", first: true, page: before }));
    await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
    if (leave) assert.equal((await post("/m/leave", { id: "leave", args: {} })).state, "sent");
    const page = await post("/sync", { from: before.watermark, stream: true });
    assert.equal(page.events.filter(e => e.table === "posts" && e.kind === "put").length, leave ? 0 : 26);
    ok(await core.call({ op: "apply", page }));
    const read = ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: Date.now() }));
    assert.equal(read.data.length, leave ? 0 : 2);
  }
});

// The core admits this Rust-level schema; Quarry's public-subset spelling is
// still unbuilt. Rust tests exercise its server selection; this is its wasm apply.
test("wasm public retained history keeps only served rows on a closed horizonless join", async t => {
  const backend = structuredClone(rawBackend);
  backend.schema.tables.messages.rules.read = "Allow";
  backend.schema.tables.messages.sync.horizon = null;
  for (const served of [false, true]) {
    const core = await webDevice({ wasm, persist: memoryPersistence() }).open(`public-closed-${served}`, backend);
    t.after(() => core.close());
    ok(await core.call({ op: "apply", first: true, page: { snapshot: true, events: [membership], watermark: 1, more: false } }));
    if (served) ok(await core.call({ op: "apply", page: { snapshot: false, events: Array.from({ length: 26 }, (_, i) => message(i)), watermark: 2, more: false } }));
    ok(await core.call({ op: "apply", page: { snapshot: false, events: [{ table: "messages", id: "scope", kind: "scope", data: ["c1"] }], watermark: 3, more: false } }));
    assert.equal(ok(await rawQuery(core)).data.length, served ? 26 : 0);
  }
});

for (const change of ["move-up", "move-down", "remove", "hide", "remove-both"]) test(`wasm current selection fills a changed historical candidate set: ${change}`, { timeout: hangBudget(5000) }, async t => {
  const { post, core } = await reviewServer(t);
  await post("/seed", [1500, 2000, 3000].map((at, i) => ({ table: "posts", row: { id: `p${i + 1}`, group: "g", at } })));
  const before = await post("/sync", { from: 0 }); ok(await core.call({ op: "apply", first: true, page: before }));
  await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
  assert.equal((await post("/m/remove", { id: "remove-p2", args: { p: "p2" } })).state, "sent");
  assert.equal((await post("/m/move", { id: "move-p3", args: { p: "p3", at: 1000 } })).state, "sent");
  const op = change.startsWith("move") ? "move" : change === "remove-both" ? "remove" : change;
  assert.equal((await post(`/m/${op}`, { id: "change", args: { p: change === "remove-both" ? "p3" : "p1", ...(op === "move" ? { at: change === "move-up" ? 2500 : 500 } : {}) } })).state, "sent");
  const first = await post("/sync", { from: before.watermark, stream: true, limit: 1 });
  const expected = change === "move-up" ? [{ id: "p1", at: 2500 }, { id: "p3", at: 1000 }] : change === "move-down" ? [{ id: "p3", at: 1000 }, { id: "p1", at: 500 }] : change === "remove-both" ? [{ id: "p1", at: 1500 }] : [{ id: "p3", at: 1000 }];
  assert.deepEqual(first.events.filter(e => e.kind === "put").map(e => ({ id: e.id, at: e.data.at })), expected);
  const snapshot = await post("/sync", { from: 0 });
  const floors = first.acquisitions.filter(a => a.floor).map(a => a.floor);
  assert.deepEqual(floors, snapshot.acquisitions.filter(a => a.floor).map(a => a.floor));
  if (!change.startsWith("move")) assert.deepEqual(floors, ["whole"]);
  const page = await post("/sync", { from: before.watermark, stream: true }); ok(await core.call({ op: "apply", page }));
  const read = ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: Date.now() }));
  assert.deepEqual(read.data, expected); assert.equal(read.complete, true); assert.equal(read.unknown, false);
});

// Generated by the Rust fixture used on SQLite and MemoryStore. The mixed rule
// is intentionally constructed in Rust because Quarry refuses that schema.
let reviewFixtures;
function rustReviewFixtures() {
  return reviewFixtures ??= (async () => {
    const directory = mkdtempSync(join(tmpdir(), "sb4-review-wire-"));
    const output = join(directory, "pages.json");
    try {
      await promisify(execFile)("cargo", ["test", "-p", "snapback4-device", "--test", "w13g_probe", "renewal_review::export_wire_fixtures", "--", "--exact"], {
        cwd: root, env: { ...process.env, SNAPBACK4_REVIEW_FIXTURES: output }, timeout: hangBudget(300), maxBuffer: 4 * 1024 * 1024,
      });
      return JSON.parse(readFileSync(output, "utf8"));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  })();
}
for (const kind of ["cold", "gap", "revoke", "unlimited"]) for (const horizon of [false, true]) for (const split of [false, true]) {
  if (kind === "unlimited" && (!horizon || !split)) continue;
  test(`wasm review renewal ${kind} horizon=${horizon} split=${split}`, { timeout: hangBudget(5000) }, async t => {
    const f = (await rustReviewFixtures()).renewals.find(f => f.kind === kind && f.horizon === horizon && f.split === split);
    const persist = memoryPersistence(), core = await webDevice({ wasm, persist }).open(f.name, f.backend); t.after(() => core.close());
    for (const [i, page] of f.initial.entries()) ok(await core.call({ op: "apply", first: i === 0, page }));
    if (kind === "gap") assert.notEqual(ok(await core.call({ op: "query", name: "one", viewer: "dev:bob", args: { p: "p3" }, now: 100 })).data, null);
    for (const page of f.pages) ok(await core.call({ op: "apply", page }));
    if (kind === "gap") assert.equal(ok(await core.call({ op: "query", name: "one", viewer: "dev:bob", args: { p: "p3" }, now: f.now })).data, null, "scope clears the gap deletion");
    const query = c => core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c }, now: f.now }).then(ok);
    const read = await query(null);
    assert.deepEqual(read.data, f.expected); assert.equal(read.complete, true); assert.equal(read.unknown, false);
    assert.equal(f.pages.length, split ? kind === "revoke" ? 4 : 2 : 1);
    const events = f.pages.flatMap(p => p.events).filter(e => e.table === "posts"), markers = f.pages.flatMap(p => p.acquisitions);
    assert.equal(events.filter(e => e.kind === "put").length, kind === "gap" || horizon ? 2 : 3);
    assert.equal(markers.length, horizon ? 2 : 0);
    if (horizon) {
      assert.equal(markers[1].floor, f.floor);
      assert.deepEqual((await persist.load(f.name)).filter(e => e.s === "m" && e.k.startsWith("device:acquisition-boundaries:")).map(e => e.v), [f.floor]);
      const below = await query(read.next); assert.equal(below.complete, false); assert.equal(below.unknown, true);
    }
    if (kind === "gap" || kind === "revoke") {
      assert.equal(events[0].kind, "scope");
      assert.equal(events.filter(e => e.kind === "scope").length, 1);
      if (horizon) {
        const acquisition = f.pages.find(p => p.acquisitions.length);
        assert.equal(acquisition.acquisitions[0].at, acquisition.events.findIndex(e => e.table === "posts" && e.kind === "put"));
      }
    }
    if (kind === "gap") assert.equal(ok(await core.call({ op: "query", name: "one", viewer: "dev:bob", args: { p: "p3" }, now: f.now })).data, null);
    if (split) {
      assert.deepEqual(f.pages.at(-1).events.filter(e => e.table === "posts"), []); assert.deepEqual(f.pages.at(-1).acquisitions, []);
      if (kind === "revoke") { assert.deepEqual(f.pages[0].events.filter(e => e.table === "posts"), []); assert.deepEqual(f.pages[0].acquisitions, []); }
    }
  });
}
for (const kind of ["renew", "rejoin", "twice", "later"]) for (const horizon of [false, true]) for (const split of [false, true]) for (const retained of [false, true]) {
  test(`wasm review same-commit ${kind} horizon=${horizon} split=${split} retained=${retained}`, { timeout: hangBudget(5000) }, async t => {
    const f = (await rustReviewFixtures()).same_commit.find(f => f.kind === kind && f.horizon === horizon && f.split === split && f.retained === retained);
    const persist = memoryPersistence(), core = await webDevice({ wasm, persist }).open(f.name, f.backend); t.after(() => core.close());
    for (const page of f.pages) ok(await core.call({ op: "apply", page }));
    const query = c => core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c }, now: f.now }).then(ok);
    const read = await query(null);
    assert.deepEqual(read.data, f.expected); assert.equal(read.complete, true); assert.equal(read.unknown, false);
    assert.equal(f.pages.length, split ? 2 : 1);
    const events = f.pages.flatMap(p => p.events).filter(e => e.table === "posts"), markers = f.pages.flatMap(p => p.acquisitions);
    const puts = events.filter(e => e.kind === "put");
    assert.deepEqual(puts.map(e => e.id), horizon ? ["p3", "p2"] : ["p3", "p2", "p1"], "one acquisition per live chain");
    assert.deepEqual(f.positions, puts.map(() => f.position), "acquire at the chain's first join ordinal");
    assert.equal(events.filter(e => e.kind === "scope").length, 0, "a grant born and undone in its commit delivers nothing, not even a scope");
    assert.equal(markers.length, horizon ? 2 : 0);
    if (horizon) {
      const start = f.pages[0].events.findIndex(e => e.table === "posts" && e.kind === "put");
      assert.equal(markers[0].at, start); assert.equal(markers[0].floor, undefined);
      assert.equal(markers[1].at, start + 2); assert.equal(markers[1].floor, f.floor);
      assert.deepEqual((await persist.load(f.name)).filter(e => e.s === "m" && e.k.startsWith("device:acquisition-boundaries:")).map(e => e.v), [f.floor]);
      const below = await query(read.next); assert.equal(below.complete, false); assert.equal(below.unknown, true);
    } else {
      const rest = await query(read.next); assert.deepEqual(ids(rest), ["p1"]); assert.equal(rest.complete, true); assert.equal(rest.unknown, false);
    }
    if (retained) assert.deepEqual(f.pages.flatMap(p => p.joined.posts ?? []), [["g"]], "only the surviving join names the held group");
    if (split) { assert.deepEqual(f.pages[1].events.filter(e => e.table === "posts"), []); assert.deepEqual(f.pages[1].acquisitions, []); }
  });
}
for (const snapshot of [false, true]) test(`wasm review mixed-readable generated pages snapshot=${snapshot}`, { timeout: hangBudget(5000) }, async t => {
  const observations = [];
  for (const f of (await rustReviewFixtures()).mixed.filter(f => f.snapshot === snapshot)) {
    const persist = memoryPersistence(), core = await webDevice({ wasm, persist }).open(f.name, f.backend); t.after(() => core.close());
    for (const [i, page] of f.pages.entries()) ok(await core.call({ op: "apply", first: snapshot && i === 0, page }));
    const query = c => core.call({ op: "query", name: "timeline", viewer: "bob", args: { c }, now: 3 }).then(ok);
    const read = await query(null);
    assert.deepEqual(ids(read), f.readable ? ["r2", "r1"] : []); assert.equal(read.complete, true); assert.equal(read.unknown, false);
    const floors = (await persist.load(f.name)).filter(e => e.s === "m" && e.k.startsWith("device:acquisition-boundaries:")).map(e => e.v);
    assert.deepEqual(floors, [f.floor]);
    if (f.readable) {
      const below = await query(read.next); assert.equal(below.complete, false); assert.equal(below.unknown, true); assert.deepEqual(below.data, []);
    } else { assert.equal(read.next, null); assert.equal(f.floor, "whole"); }
    observations.push({ pages: f.pages, read, floors });
  }
  for (const n of [1, 2, 3]) assert.deepEqual(observations[n], observations[0], "hidden or deleted history cannot change the wire or device answer");
  assert.deepEqual(observations[4], observations[5], "an empty readable group stays whole under 1000 hidden rows");
});

for (const retained of [false, true]) for (const staged of [false, true]) test(`wasm review duplicate below the floor retained=${retained} staged=${staged}`, { timeout: hangBudget(5000) }, async t => {
  const source = reviewSource.replace("  sync to members", `${retained ? "  retain delivered-history\n" : ""}  sync to members`)
    + "\nquery one(p: posts):\n  return posts[p]\n";
  const { post, core, persisted } = await reviewServer(t, source);
  await post("/seed", [1000, 2000, 3000].map((at, i) => ({ table: "posts", row: { id: `p${i + 1}`, group: "g", at } })));
  const before = await post("/sync", { from: 0 });
  ok(await core.call({ op: "apply", first: true, page: { ...before, stage_snapshot: staged } }));
  await post("/seed", [{ table: "members", row: { id: "m", group: "g", person: "dev:bob" } }]);
  await post("/seed", [{ table: "posts", row: { id: "p4", group: "g", at: 4000 } }]);
  const first = await post("/sync", { from: before.watermark, stream: true, limit: 1 });
  assert.deepEqual(first.events.map(e => e.id), ["p4", "p3"]); assert.equal(first.more, true);
  const floor = first.acquisitions[1].floor;
  ok(await core.call({ op: "apply", page: { ...first, snapshot_catchup: staged } }));
  for (const id of ["below", "duplicate-below"]) assert.equal((await post("/m/move", { id, args: { p: "p4", at: 500 } })).state, "sent");
  let from = first.watermark, count = 0;
  for (;;) {
    const page = await post("/sync", { from, stream: true, limit: 1 });
    assert.deepEqual(page.events.map(e => [e.id, e.data.at]), [["p4", 500]]);
    assert.deepEqual(page.acquisitions ?? [], []);
    ok(await core.call({ op: "apply", page: { ...page, snapshot_catchup: staged } }));
    count++; from = page.watermark; if (!page.more) break;
  }
  assert.equal(count, 3, "original insert plus two moves all carry the same current image below the acquired floor");
  const one = ok(await core.call({ op: "query", name: "one", viewer: "dev:bob", args: { p: "p4" }, now: Date.now() }));
  assert.equal(one.data.at, 500);
  const read = ok(await core.call({ op: "query", name: "timeline", viewer: "dev:bob", args: { g: "g", c: null }, now: Date.now() }));
  assert.deepEqual(ids(read), ["p3"]); assert.equal(read.complete, false); assert.equal(read.unknown, true);
  assert.deepEqual((await persisted()).filter(e => e.s === "m" && e.k.startsWith("device:acquisition-boundaries:")).map(e => e.v), [floor]);
  assert.equal((await persisted()).filter(e => e.s === "r" && e.k === JSON.stringify(["posts", "p4"])).length, 1, "all duplicate puts leave one row");
});
