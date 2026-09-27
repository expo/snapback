// @ref LLP 3000.021#3.1 — the comparative's history works through one ordinary query.
// @ref LLP 3000.021#3.4 — guide screen/history survive leave, remount and reopen on real devices.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, mintId } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";
import { binary, server, until } from "./helpers/app-server.mjs";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const comparative = readFileSync(new URL("../../../crates/snapback4-lang/tests/history/comparative.q", import.meta.url), "utf8");
const query = name => ({ kind: "query", name });
const mutation = name => ({ kind: "mutation", name });
const card = name => readFileSync(new URL(`../../../crates/snapback4-lang/src/guide/${name}.rs`, import.meta.url), "utf8").match(/```quarry\n([\s\S]*?)\n```/)[1];

async function fixture(t, tier, source) {
  const { url, dir } = await server(t, "", source);
  const clients = [], requests = [], observations = [], gates = new Set();
  let offline = false, frozen = false, core;
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "devices") });
  const device = { async open(...args) {
    core = await opener.open(...args);
    const current = core;
    return { close: () => current.close(), async call(request) {
      const reply = await current.call(request);
      if (request.op === "query") observations.push({ name: request.name, ...reply.ok });
      return reply;
    } };
  } };
  const transport = async (input, init) => {
    if (offline) throw new TypeError("test network offline");
    const path = new URL(input).pathname;
    if (frozen && path === "/sync") await new Promise((resolve, reject) => {
      const done = () => { gates.delete(done); init.signal?.removeEventListener("abort", abort); resolve(); };
      const abort = () => { gates.delete(done); reject(init.signal.reason); };
      if (init.signal?.aborted) return abort();
      gates.add(done); init.signal?.addEventListener("abort", abort, { once: true });
    });
    if (offline) throw new TypeError("test network offline");
    requests.push(path);
    return fetch(input, init);
  };
  const options = { url, persona: "bob", device, fetch: transport, waitSeconds: 0 };
  const open = async () => { const client = await createLocalClient(options); clients.push(client); return client; };
  const online = persona => { const client = createClient({ url, persona }); clients.push(client); return client; };
  t.after(async () => { frozen = false; offline = true; for (const release of [...gates]) release(); for (const client of clients) await client.close(); });
  return { url, open, online, requests, observations,
    freeze() { frozen = true; },
    network(on) { offline = !on; frozen = false; for (const release of [...gates]) release(); },
    seed: async rows => { const reply = await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify(rows) }).then(r => r.json()); assert.equal(reply.seeded, rows.length, JSON.stringify(reply)); },
    local: (name, args) => core.call({ op: "query", name, args, viewer: "dev:bob", now: Date.now() }),
  };
}
async function sent(client, name, args) {
  const write = await client.mutate(mutation(name), args);
  assert.equal(write.state, "sent", JSON.stringify(write));
  return write.result;
}

for (const tier of ["wasm", "process"]) {
  test(`${tier}: comparative DM before acquisition, HTTP decorations, and unpredicted offline send`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier, comparative), alice = f.online("alice"), bobHttp = f.online("bob");
    for (const [client, name] of [[alice, "alice"], [bobHttp, "bob"]]) {
      await sent(client, "saveProfile", { displayName: name, handle: name, bio: null, location: null, link: null });
    }
    const bob = await f.open(); await bob.sync(); f.freeze();
    const conversation = await sent(alice, "createDm", { id: mintId(), other: "dev:bob" });
    const first = await sent(alice, "sendText", { id: mintId(), conversation, text: "before acquisition", quote: null });
    assert.equal((await f.local("history", { conversation })).ok.unknown, true, "this device has not acquired the new DM");
    const before = f.requests.length;
    const history = await bob.query(query("history"), { conversation });
    assert.equal(history.data?.[0]?.id, first, JSON.stringify(history));
    assert.ok(f.requests.slice(before).includes("/q/history"), "ordinary fallback fetched the new DM");
    assert.ok(f.observations.some(read => read.name === "history" && read.unknown && read.data.length === 0));
    const reply = await sent(alice, "sendText", { id: mintId(), conversation, text: "a quoted reply", quote: first });
    const http = await bobHttp.query(query("history"), { conversation });
    assert.deepEqual(http.data.map(m => m.id), [reply, first]);
    assert.equal(http.data[0].quote, first);
    for (const field of ["quoteRow", "author", "receipt", "myReaction"]) assert.equal(Object.hasOwn(http.data[0], field), false);
    // The comparative's m3-a10 quoted excerpt assertion belongs to this query.
    assert.equal((await bobHttp.query(query("quotedMessage"), { message: reply })).data.text, "before acquisition");
    assert.equal((await bobHttp.query(query("profileFor"), { owner: "dev:alice" })).data.displayName, "alice");
    assert.equal((await bobHttp.query(query("messageReceipts"), { conversation })).data[0].receipt, "sent");
    await sent(bobHttp, "setReaction", { messageId: reply, emoji: "yes" });
    assert.equal((await bobHttp.query(query("myReaction"), { message: reply })).data.emoji, "yes");
    assert.equal((await bobHttp.query(query("searchHeld"), { q: "acquisition" })).denied?.code, "E_QUERY_HELD");

    f.network(false); await bob.sync();
    const args = { id: mintId(), conversation, text: "queued without a bubble", quote: null };
    const queued = await bob.mutate(mutation("sendText"), args, { id: mintId(), waitSeconds: 0 });
    assert.equal(queued.state, "pending", JSON.stringify(queued));
    const writes = await bob.pendingWrites();
    assert.equal(writes.length, 1); assert.equal(writes[0].id, queued.id);
    assert.equal(writes[0].op, "sendText"); assert.deepEqual(writes[0].args, args);
    assert.deepEqual(writes[0].predicted, []);
    assert.match(writes[0].reason, /queued without a row/);
    assert.equal((await f.local("history", { conversation })).ok.data.length, 0);
    // Its intent, not a second application queue, survives device reopen.
    await bob.close(); const reopened = await f.open();
    assert.equal((await reopened.pendingWrites())[0].id, queued.id);
    f.network(true); await reopened.sync();
    await until(async () => (await reopened.pendingWrites()).length === 0, "queued send settled");
    const settled = await bobHttp.query(query("history"), { conversation });
    assert.equal(settled.data.filter(row => row.id === args.id).length, 1);
    assert.equal((await reopened.query(query("searchHeld"), { q: "acquisition" })).data[0].id, first);
  });
}

const guides = [
  { name: "app", source: card("app") + "\nmutation leaveScreen(conversationId: conversations):\n  delete memberships[conversationId, viewer]\n", history: "thread", screen: "conversationScreen", argument: "conversationId", members: "memberships", body: "body", leave: "leaveScreen" },
  { name: "receipts", source: card("receipts"), history: "history", screen: "conversationScreen", argument: "conversation", members: "members", body: "text", leave: "leave" },
  { name: "comparative", source: comparative, history: "history", screen: "conversationById", argument: "conversation", members: "members", body: "text", leave: "removeMember" },
];
for (const tier of ["wasm", "process"]) for (const g of guides) {
  test(`${tier}: ${g.name} screen and history after leave, remount and offline/online reopen`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier, g.source), alice = f.online("alice"), bobHttp = f.online("bob");
    const args = { [g.argument]: "chat" }, groupKey = g.argument;
    const chat = { id: "chat", title: "Retained conversation", creatorId: "dev:alice" };
    const membership = (name, role) => ({ id: `member-${name}`, [groupKey]: "chat", principal: `dev:${name}`, ...(g.name === "app" ? { role, joinedAt: 1 } : { joinedOrdinal: 0, ...(g.name === "comparative" ? { role, handle: name } : {}) }) });
    const message = { id: "message", [groupKey]: "chat", [g.body]: "retained text", at: 1, ...(g.name === "app" ? { authorId: "dev:alice" } : { sender: "dev:alice", ordinal: 1, recipients: 1, ...(g.name === "comparative" ? { kind: "text" } : {}) }) };
    await f.seed([
      { table: "conversations", row: { ...chat, ...(g.name === "app" ? {} : { lastOrdinal: 1 }), ...(g.name === "comparative" ? { kind: "group" } : {}) } },
      { table: g.members, row: membership("alice", "admin") }, { table: g.members, row: membership("bob", "member") },
      { table: "messages", row: message },
    ]);
    let bob = await f.open(); await bob.sync();
    const assertScreen = async () => {
      const parent = await bob.query(query(g.screen), args), history = await bob.query(query(g.history), args);
      assert.equal(parent.data?.title, chat.title, JSON.stringify(parent));
      assert.equal(history.data?.[0]?.[g.body], "retained text", JSON.stringify(history));
      assert.equal(parent.denied, undefined); assert.equal(history.denied, undefined);
    };
    const mount = async () => {
      const parent = bob.observe(query(g.screen), args), history = bob.observe(query(g.history), args);
      const stops = [parent.subscribe(() => {}), history.subscribe(() => {})];
      await until(() => parent.getSnapshot().data?.title === chat.title && history.getSnapshot().data?.[0]?.[g.body] === "retained text", "mounted retained screen");
      return () => { stops.forEach(stop => stop()); parent.close(); history.close(); };
    };
    await assertScreen(); let unmount = await mount();
    if (g.name === "comparative") await sent(alice, g.leave, { conversation: "chat", principal: "dev:bob" });
    else await sent(bobHttp, g.leave, args);
    await bob.sync();
    // The guide memberships are until-revoked; the comparative originally retains members too.
    if (g.name !== "comparative") assert.deepEqual((await bob.query(query("inbox"), {})).data, []);
    assert.equal((await bobHttp.query(query(g.screen), args)).data, null, "retention grants no server authority");
    assert.deepEqual((await bobHttp.query(query(g.history), args)).data, []);
    const from = f.requests.length;
    for (const online of [false, true]) {
      f.network(online); await bob.sync(); await assertScreen();
      unmount(); unmount = await mount(); await assertScreen();
      unmount(); await bob.close(); bob = await f.open(); await bob.sync();
      await assertScreen(); unmount = await mount();
    }
    unmount();
    assert.ok(!f.requests.slice(from).some(path => path === `/q/${g.screen}` || path === `/q/${g.history}`), "retained reads never substituted an empty server answer");
  });
}
