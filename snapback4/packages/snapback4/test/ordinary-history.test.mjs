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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { syncControl, parkedChanges } from "./helpers/sync-control.mjs";
import { History } from "./fixtures/ordinary-history.mjs";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const comparative = readFileSync(new URL("../../../crates/snapback4-lang/tests/history/comparative.q", import.meta.url), "utf8");
const query = name => ({ kind: "query", name });
const mutation = name => ({ kind: "mutation", name });
const card = name => readFileSync(new URL(`../../../crates/snapback4-lang/src/guide/${name}.rs`, import.meta.url), "utf8").match(/```quarry\n([\s\S]*?)\n```/)[1];

async function fixture(t, tier, source, controlled = false) {
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
  const control = syncControl(t);
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
    if (controlled && path === "/changes") return parkedChanges(init.signal);
    return control.fetch(input, init);
  };
  const options = { url, persona: "bob", device, fetch: transport, waitSeconds: 0 };
  const open = async () => { const client = await createLocalClient(options); clients.push(client); return client; };
  const online = persona => { const client = createClient({ url, persona }); clients.push(client); return client; };
  t.after(async () => { frozen = false; offline = true; for (const release of [...gates]) release(); for (const client of clients) await client.close(); });
  return { url, open, online, requests, observations, control,
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
  test(`${tier}: comparative history preserves stored fields, edits and view-once assets`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier, comparative), alice = f.online("alice"), bobHttp = f.online("bob");
    for (const [client, name] of [[alice, "alice"], [bobHttp, "bob"]]) {
      await sent(client, "saveProfile", { displayName: name, handle: name, bio: null, location: null, link: null });
    }
    const conversation = await sent(alice, "createDm", { id: mintId(), other: "dev:bob" });
    const first = await sent(alice, "sendText", { id: mintId(), conversation, text: "edit me", quote: null });
    await sent(alice, "editMessage", { messageId: first, text: "edited now", caption: null });
    const quote = await sent(alice, "sendText", { id: mintId(), conversation, text: "quoted reply", quote: first });
    const png = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64")], { type: "image/png" });
    const images = [];
    for (const viewOnce of [false, true]) {
      const uploaded = await alice.upload(png); assert.equal(uploaded.ok, true);
      const id = await sent(alice, "sendImage", { id: mintId(), conversation, photo: { id: uploaded.asset.id }, caption: viewOnce ? "once" : "photo", viewOnce });
      images.push({ id, asset: uploaded.asset.id, viewOnce });
    }
    const bob = await f.open(); await bob.sync();
    for (const client of [bobHttp, bob]) {
      const history = await client.query(query("history"), { conversation });
      assert.deepEqual(history.data.map(row => row.id), [images[1].id, images[0].id, quote, first]);
      for (const row of history.data) {
        const fields = ["id", "conversation", "sender", "ordinal", "recipients", "kind", "text", "caption", "photo", "photoOnce", "clip", "quote", "tombstone", "editedAt", "at", "expiresAt"];
        for (const field of fields) assert.ok(Object.hasOwn(row, field), `history lost stored column ${field}`);
        assert.equal(row.conversation, conversation); assert.equal(row.sender, "dev:alice");
        assert.equal(row.recipients, 1); assert.equal(row.tombstone, false);
        assert.equal(typeof row.at, "number"); assert.ok(row.at > 0);
        assert.equal(row.expiresAt, null); assert.equal(row.clip, null);
        for (const field of ["quoteRow", "author", "receipt", "myReaction"]) assert.equal(Object.hasOwn(row, field), false);
      }
      const edited = history.data.find(row => row.id === first);
      assert.equal(edited.text, "edited now"); assert.ok(edited.editedAt, "m4-a09: editedAt missing");
      assert.equal(edited.ordinal, 1); assert.equal(edited.kind, "text");
      assert.equal(edited.quote, null); assert.equal(edited.caption, null);
      assert.equal(edited.photo, null); assert.equal(edited.photoOnce, null);
      assert.equal(history.data.find(row => row.id === quote).quote, first, "m3-a11: quote id missing");
      for (const { id, asset, viewOnce } of images) {
        const row = history.data.find(row => row.id === id);
        assert.equal(row.kind, "image"); assert.equal(row.caption, viewOnce ? "once" : "photo");
        assert.equal(row[viewOnce ? "photoOnce" : "photo"]?.id, asset, "m5-a04: asset missing");
        assert.equal(row[viewOnce ? "photo" : "photoOnce"], null);
      }
      const markup = renderToStaticMarkup(createElement(History, { history, pending: [], conversation }));
      assert.match(markup, /edited now/); assert.match(markup, />edited</); assert.match(markup, /View once/);
      assert.ok(markup.includes(`data-asset="${images[1].asset}"`));
      assert.ok(markup.includes(`href="#msg-${first}"`));
    }
    const once = (await bobHttp.query(query("history"), { conversation })).data.find(row => row.id === images[1].id);
    const opened = await bobHttp.asset(once.photoOnce.id);
    assert.ok(!("denied" in opened), "m5-a04: first view should work"); opened.revoke();
    assert.ok("denied" in await bobHttp.asset(once.photoOnce.id), "m5-a05: second view must be denied");
    await sent(bobHttp, "setReaction", { messageId: first, emoji: "yes" });
    await sent(bobHttp, "setReaction", { messageId: first, emoji: "heart" });
    assert.equal((await bobHttp.query(query("myReaction"), { message: first })).data.emoji, "heart");
    await sent(bobHttp, "setReaction", { messageId: first, emoji: "none" });
    assert.equal((await bobHttp.query(query("myReaction"), { message: first })).data, null);
    await sent(alice, "deleteMessage", { messageId: first });
    const deleted = (await bobHttp.query(query("history"), { conversation })).data.find(row => row.id === first);
    assert.equal(deleted.tombstone, true); assert.equal(deleted.text, null);
    assert.match(renderToStaticMarkup(createElement(History, { history: { data: [deleted] }, pending: [], conversation })), /This message was deleted/);
  });

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
    // A reported cut can bypass this unacquired replica altogether; its raw
    // unknown result was checked above, and the public answer must be current.
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
    await t.test("history and queued sends render while separate decorations load or refuse", () => {
      for (const state of [{ loading: true }, { denied: { code: "NOT_MEMBER", message: "Decoration unavailable" } }]) {
        const decorations = Object.fromEntries(http.data.map(row => [row.id, { profile: state, quote: state, receipt: state, reaction: state }]));
        const markup = renderToStaticMarkup(createElement(History, { history: http, pending: writes, conversation, decorations }));
        assert.match(markup, /before acquisition/); assert.match(markup, /a quoted reply/);
        assert.match(markup, /queued without a bubble/); assert.match(markup, /queued/);
        assert.ok(markup.includes(`href="#msg-${first}"`), "stored quote keeps its jump while the excerpt loads");
        assert.equal((markup.match(/<article\b/g) ?? []).length, 3, markup);
        assert.equal((markup.match(/data-decoration=/g) ?? []).length, 8, markup);
        assert.match(markup, state.loading ? /Loading…/ : /Decoration unavailable/);
      }
      const decorations = { [reply]: { profile: { data: { displayName: "Alice" } }, quote: { data: { text: "quoted excerpt" } }, receipt: { data: [{ id: reply, receipt: "delivered" }] }, reaction: { data: { emoji: "heart" } } } };
      const decorated = renderToStaticMarkup(createElement(History, { history: http, pending: writes, conversation, decorations }));
      for (const text of ["Alice", "quoted excerpt", "delivered", "heart", "queued without a bubble"]) assert.ok(decorated.includes(text));
    });
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
for (const tier of ["wasm", "process"]) for (const g of guides) for (const controlled of g.name === "receipts" ? [false, true] : [false]) {
  test(`${tier}: ${g.name} screen and history after leave, remount and offline/online reopen${controlled ? " (older sync held across leave)" : ""}`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier, g.source, controlled), alice = f.online("alice"), bobHttp = f.online("bob");
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
    let older, held;
    if (controlled) {
      await bob.sync(); held = f.control.hold();
      older = bob.sync(); await held.ready;
    }
    if (g.name === "comparative") await sent(alice, g.leave, { conversation: "chat", principal: "dev:bob" });
    else await sent(bobHttp, g.leave, args);
    const synced = bob.sync(); held?.release();
    await synced; await older;
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
