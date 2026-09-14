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
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 25 by byTime
query history(room: text <=40):
  return messages[room] last 50 by byTime
query across():
  return messages[] first 100 by byId
mutation join(room: text <=40):
  insert members {room, principal: 'dev:bob'}
mutation leave(room: text <=40):
  delete members[room = room, principal = 'dev:bob']
`;
for (const tier of ["wasm", "process"]) test(`R5 ${tier}: online reads and watches keep left history; held incomplete reads use the server`, { timeout: 60000 }, async (t) => {
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
  const rows = ["left", "held"].flatMap((room) => Array.from({ length: 26 }, (_, at) => ({ table: "messages", row: { id: `${room}-${at}`, room, at, body: "delivered" } })));
  rows.push(...["left", "held"].map((room) => ({ table: "members", row: { id: `alice-${room}`, room, principal: "dev:alice" } })));
  assert.equal((await post("/seed", rows)).seeded, 54);
  for (const room of ["left", "held"]) assert.equal((await post("/m/join", { args: { room }, id: `join-${room}` })).state, "sent");
  let offline = false;
  const requests = [], deviceAnswers = [];
  const directoryDevice = join(directory, "device"); mkdirSync(directoryDevice);
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice(binary, directoryDevice, (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), async (path, text) => writeFileSync(path, text));
  client = await createLocalClient({ url, persona: "bob", waitSeconds: 1,
    fetch: async (input, init) => { if (offline) throw new TypeError("test offline"); if (new URL(input).pathname === "/q/history") requests.push(JSON.parse(init.body).args.room); return fetch(input, init); },
    device: { open: async (...args) => { const core = await opener.open(...args); return { close: () => core.close(), call: async (request) => { const reply = await core.call(request); if (request.op === "query" && request.name === "history") deviceAnswers.push({ room: request.args.room, ...reply.ok }); return reply; } }; } },
  });
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
