import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { createApp } from "snapback4/app";
import { createClient, mintId } from "snapback4/client";
import { memorySessionStore } from "snapback4/auth";
import { webDevice, memoryPersistence } from "snapback4/web";
import { createLocalClient } from "snapback4/local";
import { processDevice } from "snapback4/native";
import { binary, server, until } from "./helpers/app-server.mjs";
import { parkedChanges } from "./helpers/sync-control.mjs";

const root = resolve(import.meta.dirname, "../../..");
function starter(t) {
  // Under the workspace so TypeScript sees the installed public dependencies.
  const dir = mkdtempSync(join(root, ".social-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [["new", dir, "--template", "social"], ["check"]]) {
    const result = spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  return dir;
}
test("new requires an explicit template and names what init creates", t => {
  const dir = mkdtempSync(join(root, ".social-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync(binary, ["new", dir], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Choose a template: social/);
  assert.match(result.stderr, /schema-only setup use snapback4 init/);
  assert.deepEqual(readdirSync(dir), []);
});

// @ref LLP 3000.028#7.3 — the starter must acquire owner coverage beyond its public window.
for (const tier of ["native", "web"]) {
  test(`social starter ${tier}: cold owner keys prove old likes and unqueried absence offline`, { timeout: hangBudget(11) }, async t => {
    const generated = starter(t), api = await generatedApi(generated);
    const { url, dir } = await server(t, undefined, readFileSync(join(generated, "snapback/schema.q"), "utf8"));
    const signup = await fetch(`${url}/auth/signup`, { method: "POST", body: JSON.stringify({
      email: "cold@example.com", password: "cold-owner-coverage-password",
    }) }).then(r => r.json());
    assert.ok(signup.session, JSON.stringify(signup));
    const owner = signup.session.principal;
    const author = createClient({ url, token: signup.session.token });
    t.after(() => author.close());
    const created = await author.mutate(api.post, { body: "cold fixture" });
    assert.equal(created.state, "sent", JSON.stringify(created));
    const oldPost = created.result.id;
    // The old own like is below all 2,000 public rows. Seed before opening any
    // device: a warm stream of inserts would retain it even without the policy.
    const rows = [{ table: "likes", row: { id: "old-like", post: oldPost, principal: owner, at: 1 } }];
    for (let n = 0; n < 2_000; n++) rows.push({ table: "likes", row: {
      id: `recent-like-${n}`, post: oldPost, principal: `dev:reader${n}`, at: n + 2,
    } });
    const seeded = await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify(rows) }).then(r => r.json());
    assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
    const device = tier === "native" ? processDevice({ binary, dir: join(dir, "device") })
      : webDevice({ persist: memoryPersistence(), wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")) });
    let offline = false, allowAcquisition = false;
    const client = await createLocalClient({ url, session: signup.session, device,
      fetch: (input, init) => {
        const path = new URL(input).pathname;
        if (offline || (path === "/sync" && !allowAcquisition)) throw new TypeError("disconnected");
        if (path === "/changes") return parkedChanges(init.signal);
        return fetch(input, init);
      },
    });
    t.after(() => client.close());
    offline = true;
    assert.equal(client.acquired, false);
    for (const post of [oldPost, "absent-before-acquisition"]) {
      const read = await client.query(api.postState, { post });
      assert.equal(read.denied?.code, 'E_OFFLINE', JSON.stringify(read));
      assert.equal(read.data, undefined, "an unacquired owner has unknown coverage, never false");
    }
    offline = false; allowAcquisition = true;
    await client.sync();
    assert.equal(client.acquired, true);
    assert.equal((await client.residency()).tables.likes.rows, 2_000, "the public window stays bounded");
    offline = true;
    await client.sync(); // Discover the transport loss before asking for stale reads.
    for (const [post, liked] of [[oldPost, true], ["never-queried-absent-post", false]]) {
      const read = await client.query(api.postState, { post });
      assert.deepEqual(read.data, { liked }, JSON.stringify(read));
      assert.equal(read.complete, true, "complete owner partition proves presence and absence");
      assert.equal(read.fresh, false, "offline coverage is not freshness");
    }
  });
}

export async function generatedApi(dir) {
  const source = readFileSync(join(dir, "snapback/generated/api.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)).api;
}

test("published social starter and guide snippets typecheck against generated operations", t => {
  const dir = starter(t);
  const guide = spawnSync(binary, ["guide", "social"], { encoding: "utf8" });
  assert.equal(guide.status, 0, guide.stderr);
  const snippets = [...guide.stdout.matchAll(/```tsx?\n\/\/ (src\/[^\n]+)\n([\s\S]*?)```/g)];
  assert.equal(snippets.length, 7);
  for (const [, name, source] of snippets) {
    assert.equal(source, readFileSync(join(dir, name), "utf8"), `${name}: card and installed file`);
    writeFileSync(join(dir, name), source); // Compile the emitted guide text.
  }
  const config = ts.readConfigFile(join(dir, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => dir, getNewLine: () => "\n",
  }));
});

test("bounded substitution in both installed and client documentation typechecks", t => {
  const dir = starter(t), route = join(dir, "app/conversation/[id].tsx");
  const original = readFileSync(route, "utf8");
  for (const doc of [join(dir, "README.md"), join(root, "packages/snapback4/CLIENT-AND-OPERATIONS.md")]) {
    const source = readFileSync(doc, "utf8");
    const imported = source.match(/`(import [^`]+ from "\.\.\/\.\.\/src\/BoundedConversation")`/);
    assert.ok(imported, `${doc}: executable substitution import`);
    const element = source.match(/`(<BoundedConversation [^`]+\/>)`/);
    assert.ok(element, `${doc}: substitution element`);
    writeFileSync(route, original.replace(/import \{ ConversationScreen \}[^\n]+/, imported[1] + ";")
      .replace(/<ConversationScreen [^\n]+\/>/, element[1]));
    const config = ts.readConfigFile(join(dir, "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir);
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options))];
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => dir, getNewLine: () => "\n",
    }));
  }
});

test("installed bounded placeholder documentation makes neither existence claim", t => {
  const dir = starter(t), readme = readFileSync(join(dir, "README.md"), "utf8").replace(/\s+/g, " ");
  assert.match(readme, /placeholder is evidence neither that the row exists nor that it does not/);
});

// @ref LLP 3000.028#8 — scaffold/check/dev and the installed client vocabulary.
test("social starter runs through the public client: feed, likes, receipts, typing, media and retained history", { timeout: hangBudget(62) }, async t => {
  const dir = starter(t), api = await generatedApi(dir);
  let output = "";
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", bytes => { output += bytes; }); server.stderr.on("data", bytes => { output += bytes; });
  t.after(async () => { if (server.exitCode === null) { const stopped = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); await stopped; } });
  const url = await until(() => { assert.equal(server.exitCode, null, output); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "social dev ready");
  await until(() => output.includes("notifications.mjs (pid"), "declared starter worker ready");
  const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
  const open = async () => {
    const app = createApp({ url, sessionStore: memorySessionStore(), device: webDevice({ wasm, persist: memoryPersistence() }) });
    t.after(() => app.close());
    assert.equal((await app.ready).ok, true);
    assert.equal((await app.auth.guest()).ok, true);
    return app;
  };
  const alice = await open(), bob = await open();
  const a = alice.client, b = bob.client;
  const write = async (client, op, args) => {
    const result = await client.mutate(op, args);
    assert.equal(result.state, "sent", JSON.stringify(result));
    return result.result;
  };
  await write(a, api.saveProfile, { name: "Alice" });
  assert.equal((await a.query(api.profile, { principal: a.viewer() })).data.name, "Alice");
  const post = await write(b, api.post, { body: "First social post" });
  await write(a, api.follow, { principal: b.viewer() });
  await until(async () => (await a.query(api.feed, {})).data?.some(row => row.post === post.id), "Following backfill");
  await a.sync();
  assert.deepEqual((await a.query(api.postState, { post: post.id })).data, { liked: false });
  await write(a, api.setLike, { post: post.id, liked: true });
  await until(async () => (await a.query(api.postState, { post: post.id })).data?.liked === true, "liked");
  const conversation = await write(a, api.createConversation, { title: "Friends" });
  await write(a, api.add, { conversation, principal: b.viewer() });
  const message = await write(a, api.send, { conversation, text: "coffee tomorrow", photo: null });
  await b.sync();
  await until(async () => (await b.query(api.history, { conversation })).data?.[0]?.id === message, "ordinary history");
  const allocated = (await b.query(api.history, { conversation })).data[0];
  assert.equal(allocated.ordinal, 1); assert.equal(allocated.recipients, 1);
  assert.equal((await b.query(api.receiptMember, { conversation })).data.joinedOrdinal, 0);
  await until(async () => (await a.query(api.messageReceipts, { conversation })).data?.[0]?.receipt === "delivered", "SDK delivery reporter");
  await write(b, api.seen, { conversation, through: 1 });
  await until(async () => (await a.query(api.messageReceipts, { conversation })).data?.[0]?.receipt === "read", "seen receipt");

  let offline = false, dispatched = 0;
  const online = createClient({ url, token: b.session().token, fetch: (input, init) => {
    if (offline) return Promise.reject(new Error("disconnected"));
    if (new URL(input).pathname === "/m/setTyping") dispatched++;
    return fetch(input, init);
  } });
  t.after(() => online.close());
  assert.equal((await online.mutate(api.setTyping, { conversation })).state, "sent");
  assert.equal((await a.query(api.typingIn, { conversation })).data.length, 1);
  await fetch(`${url}/dev/clock/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duration: "5s" }) });
  assert.equal((await a.query(api.typingIn, { conversation })).data.length, 0);
  offline = true;
  // End the prior lease and discover the disconnect before testing a new hint;
  // an equal renewal within 1s may legitimately reuse its last sent result.
  await online.mutate(api.stopTyping, { conversation });
  const dropped = await online.mutate(api.setTyping, { conversation });
  assert.equal(dropped.state, "failed");
  assert.deepEqual(await online.pendingWrites(), []);
  assert.deepEqual(await b.pendingWrites(), []);
  offline = false;
  const before = dispatched;
  await online.query(api.typingIn, { conversation });
  assert.equal(dispatched, before, "no typing replay on reconnect");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=", "base64");
  const upload = await a.upload(png); assert.equal(upload.ok, true, JSON.stringify(upload));
  await write(a, api.send, { conversation, text: "one photo", photo: { id: upload.asset.id } });
  await b.sync();
  const handle = await b.asset(upload.asset.id); assert.ok("url" in handle, JSON.stringify(handle)); handle.revoke();
  assert.equal((await b.asset(upload.asset.id)).denied.code, "E_ASSET_VIEWED");
  for (let n = 0; n < 21; n++) await write(a, api.send, { conversation, text: `history page ${n}`, photo: null });
  await b.sync();
  const firstPage = await b.query(api.history, { conversation });
  assert.ok(firstPage.next, "history crosses its 20-message page");
  const older = await b.query(api.history, { conversation, c: firstPage.next });
  const olderReceipts = await b.query(api.messageReceipts, { conversation, c: firstPage.next });
  assert.ok(older.data.length > 0 && "data" in olderReceipts);
  assert.deepEqual(olderReceipts.data.map(row => row.id), older.data.map(row => row.id), "real receipt query accepts the exact history cursor");
  const beforeLeave = firstPage.data.map(row => row.id);
  await write(b, api.leave, { conversation }); await b.sync();
  await write(a, api.send, { conversation, text: "after leave", photo: null }); await b.sync();
  const retained = await b.query(api.history, { conversation });
  assert.deepEqual(retained.data.map(row => row.id), beforeLeave, "ordinary history keeps only delivered images");
  assert.equal((await online.mutate(api.setTyping, { conversation })).state, "failed", "revoked member cannot renew");
  const search = await b.query(api.searchChat, { conversation, q: "coffee" });
  assert.deepEqual(search.data.map(row => row.id), [message]);
  // A concurrent sync may withdraw composition. Wait for a ready first page;
  // refusal is still a failure, and the exact retained ID is required below.
  const allSearch = await until(async () => {
    const read = await b.query(api.search, { q: "coffee" });
    assert.ok(!("denied" in read), JSON.stringify(read));
    return "loading" in read ? false : read;
  }, "ordinary retained search ready");
  assert.deepEqual(allSearch.data.map(row => row.id), [message], "ordinary all-chat search keeps the departed hit online");
  // RY: the clause stamps a fresh floor on rejoin and snapshots recipients.
  const high = (await a.query(api.conversationScreen, { conversation })).data.lastOrdinal;
  await write(a, api.add, { conversation, principal: b.viewer() }); await b.sync();
  assert.equal((await b.query(api.receiptMember, { conversation })).data.joinedOrdinal, high);
  const rejoined = await write(a, api.send, { conversation, text: "new membership", photo: null });
  await b.sync();
  const afterJoin = await until(async () => (await b.query(api.history, { conversation })).data?.find(row => row.id === rejoined), "rejoined history");
  assert.equal(afterJoin.ordinal, high + 1); assert.equal(afterJoin.recipients, 1);
  await until(async () => (await a.query(api.messageReceipts, { conversation })).data?.find(row => row.id === rejoined)?.receipt === "delivered", "rejoin delivery");
  await write(b, api.seen, { conversation, through: high + 1 });
  await until(async () => (await a.query(api.messageReceipts, { conversation })).data?.find(row => row.id === rejoined)?.receipt === "read", "rejoin read");
  const previous = b.viewer();
  await bob.auth.logout(); await bob.auth.guest();
  assert.notEqual(bob.client.viewer(), previous);
  assert.deepEqual((await bob.client.query(api.history, { conversation })).data, [], "new account has no retained old history");
});

// Both stores read a horizon-free private key; the server owns creation races.
for (const tier of ["native", "web"]) test(`social DM ${tier}: concurrent opens converge, held keys resolve offline and an offline race settles`, { timeout: hangBudget(41) }, async t => {
  const generated = starter(t), api = await generatedApi(generated);
  const { url, dir } = await server(t, undefined, readFileSync(join(generated, "snapback/schema.q"), "utf8"));
  const sessions = await Promise.all([0, 1, 2].map(() => fetch(url + "/auth/guest", { method: "POST", body: "{}" }).then(r => r.json())));
  // Accept both complete HTTP mutation requests before forwarding either to dev.
  // This barrier proves overlap before any transaction can commit, without
  // depending on two Promise.all calls happening to outrun the first response.
  const release = Promise.withResolvers(), arrivals = [];
  const gate = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    arrivals.push(JSON.parse(body));
    await release.promise;
    try {
      const reply = await fetch(url + req.url, { method: req.method, headers: req.headers, body });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(Buffer.from(await reply.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => gate.listen(0, "127.0.0.1", resolve));
  t.after(async () => { release.resolve(); await new Promise(resolve => gate.close(resolve)); });
  let holdOpens = true;
  const [a, b, outsider] = sessions.map(({ session }) => createClient({ url, token: session.token,
    fetch: (input, init) => fetch(holdOpens && new URL(input).pathname === "/m/openDirect"
      ? `http://127.0.0.1:${gate.address().port}/m/openDirect` : input, init),
  }));
  const db = new DatabaseSync(join(dir, ".snapback4/store.sqlite"), { readOnly: true });
  t.after(() => db.close());
  const exists = id => !!db.prepare("SELECT 1 FROM r WHERE id = ?").get(id);
  t.after(() => Promise.all([a.close(), b.close(), outsider.close()]));
  let offline = false;
  const device = tier === "native" ? processDevice({ binary, dir: join(dir, "dm-device") }) :
    webDevice({ persist: memoryPersistence(), wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")) });
  const local = await createLocalClient({ url, session: sessions[0].session, device, fetch: (input, init) => {
    if (offline) throw Error("offline");
    return new URL(input).pathname === "/changes" ? parkedChanges(init.signal) : fetch(input, init);
  } });
  t.after(() => local.close());
  await local.sync();
  const peer = sessions[1].session.principal;
  const absent = await local.query(api.directConversation, { other: peer });
  assert.equal(absent.data, null); assert.equal(absent.complete, true);
  offline = true; await local.sync();
  const provisional = mintId(), opening = mintId();
  const queued = await local.mutate(api.openDirect, { id: provisional, other: peer }, { id: opening, waitSeconds: 0 });
  assert.equal(queued.state, "pending", JSON.stringify(queued));
  const admission = (await local.pendingWrites()).find(w => w.id === opening);
  assert.ok(admission, "creation enters SDK custody offline");
  assert.ok(admission.predicted.length > 0, "scope, membership and direct lookup predict together");
  const pendingPair = await local.query(api.directConversation, { other: peer });
  assert.equal(pendingPair.data.conversation, provisional, JSON.stringify(pendingPair));
  assert.equal(pendingPair.data.pending, true);
  const pendingMember = await local.query(api.receiptMember, { conversation: provisional });
  assert.equal(pendingMember.data, null);
  assert.equal(pendingMember.existence, "partial", "pending membership cannot prove settled absence");
  const proposals = [mintId(), mintId()];
  let completed = 0;
  const concurrent = [
    a.mutate(api.openDirect, { id: proposals[0], other: peer }),
    b.mutate(api.openDirect, { id: proposals[1], other: sessions[0].session.principal }),
  ].map(call => call.then(write => { completed++; return write; }));
  await until(() => arrivals.length === 2, "both opposite-direction HTTP mutations in flight");
  assert.equal(completed, 0);
  assert.deepEqual(proposals.map(exists), [false, false], "neither opening has committed at the barrier");
  holdOpens = false; release.resolve();
  const opens = await Promise.all(concurrent);
  opens.forEach(w => assert.equal(w.state, "sent", JSON.stringify(w)));
  const canonical = opens[0].result;
  assert.equal(opens[1].result, canonical, "opposite directions deduplicate atomically");
  assert.notEqual(canonical, provisional);
  assert.ok(proposals.includes(canonical));
  assert.equal(exists(canonical), true);
  assert.equal(exists(proposals.find(id => id !== canonical)), false, "losing proposal leaves no conversation row");
  for (const [client, other] of [[a, peer], [b, sessions[0].session.principal]]) {
    const again = await client.mutate(api.openDirect, { id: mintId(), other });
    assert.equal(again.result, canonical);
    assert.equal((await client.query(api.directConversation, { other })).data.conversation, canonical);
    assert.deepEqual((await client.query(api.inbox, {})).data.map(r => r.conversation), [canonical]);
  }
  assert.equal((await outsider.query(api.directConversation, { other: peer })).data, null, "keys are private to their owner");
  // Query authorization alone cannot detect a widened replication audience.
  const outsiderDevice = tier === "native" ? processDevice({ binary, dir: join(dir, "outsider-device") }) :
    webDevice({ persist: memoryPersistence(), wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")) });
  const outsiderReplica = await createLocalClient({ url, session: sessions[2].session, device: outsiderDevice });
  t.after(() => outsiderReplica.close());
  await outsiderReplica.sync();
  assert.equal(outsiderReplica.acquired, true);
  assert.equal((await outsiderReplica.residency()).tables.directChats?.rows ?? 0, 0,
    "outsider replica must acquire no other participant's DM key rows");
  offline = false; await local.sync();
  const settled = await until(async () => { const w = await local.write(opening); return w?.state === "sent" && w; }, "offline open settles");
  assert.equal(settled.state, "sent"); // Recovered receipts need not carry a historical result.
  await local.sync(); offline = true; await local.sync();
  const held = await local.query(api.directConversation, { other: peer });
  assert.equal(held.data.conversation, canonical);
  assert.equal(held.complete, true); assert.equal(held.fresh, false);
  const reverse = await local.query(api.directPeer, { conversation: canonical });
  assert.equal(reverse.data.peer, peer); assert.equal(reverse.fresh, false);
  assert.equal(exists(provisional), false, "offline losing proposal also leaves no row");

  assert.equal((await a.mutate(api.leave, { conversation: canonical })).state, "sent");
  const reopened = await a.mutate(api.openDirect, { id: mintId(), other: peer });
  assert.equal(reopened.state, "sent"); assert.equal(reopened.result, canonical);
  assert.equal((await a.query(api.receiptMember, { conversation: canonical })).data, null,
    "reopening must not restore the caller's membership");
  assert.deepEqual((await a.query(api.inbox, {})).data, []);
  assert.equal((await b.mutate(api.send, { conversation: canonical, text: "private after leave", photo: null })).state, "sent");
  assert.equal((await a.query(api.conversationScreen, { conversation: canonical })).data, null);
  assert.deepEqual((await a.query(api.history, { conversation: canonical })).data, [], "no access to new content after reopen");
  const refused = await a.mutate(api.send, { conversation: canonical, text: "must refuse", photo: null });
  assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "NOT_MEMBER");
  assert.equal((await a.query(api.directConversation, { other: peer })).data.conversation, canonical);
  assert.equal((await a.query(api.directPeer, { conversation: canonical })).data.peer, peer,
    "private route identity survives leave, independently of content authority");
});

test("guide aliases send schedules, DMs and Expo readers to their owning cards", () => {
  for (const [target, aliases] of [["jobs", ["schedule", "schedules", "cron"]],
    ["social", ["dm", "direct message", "chat"]], ["client", ["expo", "ios", "react native"]]]) {
    const expected = spawnSync(binary, ["guide", target], { encoding: "utf8" });
    assert.equal(expected.status, 0);
    for (const alias of aliases) {
      const result = spawnSync(binary, ["guide", alias], { encoding: "utf8" });
      assert.equal(result.status, 0, alias); assert.equal(result.stdout, expected.stdout, alias);
      if (alias.includes(" ")) {
        const unquoted = spawnSync(binary, ["guide", ...alias.split(" ")], { encoding: "utf8" });
        assert.equal(unquoted.status, 0, alias); assert.equal(unquoted.stdout, expected.stdout, alias);
      }
    }
  }
  const native = spawnSync(binary, ["guide", "native"], { encoding: "utf8" }).stdout;
  assert.match(native.split("\n\n")[1], /Expo client.*guide client.*guide witness/);
});

test("social proposal associations are durable, account/backend scoped and preserve every send's arguments", async t => {
  const dir = starter(t);
  const source = readFileSync(join(dir, "src/intents.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { IntentJournal } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const values = new Map(); let viewer = "alice";
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const open = (url = "https://one.test", account = "alice") => new IntentJournal(storage, url, account, () => viewer === account);
  const original = ["proposal-a", "proposal-b"].map((conversation, n) => ({ id: `send-${n}`, args: { conversation, text: `unsent ${n}`, photo: null } }));
  const journal = open();
  for (const intent of original) journal.remember(intent, "bob");
  open().resolve("bob", "canonical");
  assert.deepEqual(open().proposals(), original.map(i => ({ proposed: i.args.conversation, other: "bob", canonical: "canonical" })));
  assert.deepEqual(open().read(), original, "association never rewrites admitted arguments");
  open().forget(original[0].id);
  assert.equal(open().proposals().length, 1, "dismissing a proposal's last send retires its association");
  assert.deepEqual(open("https://two.test").proposals(), []);
  viewer = "bob";
  assert.deepEqual(open("https://one.test", "bob").proposals(), []);
  assert.deepEqual(journal.proposals(), []);
  assert.throws(() => journal.resolve("bob", "wrong"), /no longer active/);
  viewer = "alice";
  assert.deepEqual(open().read(), [original[1]]);
  assert.equal(open().proposals()[0].canonical, "canonical");
  const second = { ...original[1], id: "another-send-on-same-proposal" };
  open().remember(second, "bob");
  open().forget(original[1].id);
  assert.deepEqual(open().proposals(), [{ proposed: second.args.conversation, other: "bob", canonical: "canonical" }],
    "another pending or recoverable send keeps the association, with no TTL or count eviction");
  open().forget(second.id);
  assert.equal(values.size, 0, "final dismissal empties the store");

  // Clean old successful/failed/abandoned openings which never had saved sends,
  // without dropping an unresolved association still needed for recovery.
  storage.setItem(journal.key, JSON.stringify({ intents: [original[0]], proposals: [
    { proposed: original[0].args.conversation, other: "bob" },
    ...Array.from({ length: 1101 }, (_, n) => ({ proposed: `orphan-${n}`, other: `peer-${n}`,
      ...(n < 1001 ? { canonical: `settled-${n}` } : {}) })),
  ] }));
  open().prune();
  assert.deepEqual(open().proposals(), [{ proposed: original[0].args.conversation, other: "bob" }]);
  assert.deepEqual(open().read(), [original[0]], "pruning preserves the recoverable intent verbatim");
  open().forget(original[0].id);
  assert.equal(values.size, 0);
});

// @ref LLP 3000.022#14.3 — ordinary history renders offline sends, with no application outbox merge.
test("social starter wasm: offline history predicts in compose order and settles once with receipts", { timeout: 30_000 }, async t => {
  const generated = starter(t), api = await generatedApi(generated);
  const { url } = await server(t, undefined, readFileSync(join(generated, "snapback/schema.q"), "utf8"));
  const sessions = [];
  for (const name of ["predict-alice", "predict-bob"]) {
    const response = await fetch(`${url}/auth/signup`, { method: "POST", body: JSON.stringify({
      email: `${name}@example.com`, password: "offline-receipts-password",
    }) }).then(r => r.json());
    assert.ok(response.session, JSON.stringify(response)); sessions.push(response.session);
  }
  const remote = createClient({ url, token: sessions[1].token });
  t.after(() => remote.close());
  let offline = false;
  const device = webDevice({ persist: memoryPersistence(), wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")) });
  const local = await createLocalClient({ url, session: sessions[0], device, fetch: (input, init) => {
    if (offline) throw new TypeError("offline");
    return new URL(input).pathname === "/changes" ? parkedChanges(init.signal) : fetch(input, init);
  } });
  t.after(() => local.close());
  const created = await local.mutate(api.createConversation, { title: "offline history" });
  assert.equal(created.state, "sent", JSON.stringify(created));
  const conversation = created.result;
  assert.equal((await local.mutate(api.add, { conversation, principal: sessions[1].principal })).state, "sent");
  await local.sync(); offline = true; await local.sync();
  const writes = [];
  for (const text of ["offline first", "offline second"]) {
    const write = await local.mutate(api.send, { conversation, text, photo: null }, { waitSeconds: 0 });
    assert.equal(write.state, "pending", JSON.stringify(write)); writes.push(write.id);
    const history = await local.query(api.history, { conversation });
    assert.equal(history.existence, "present", JSON.stringify(history));
    assert.equal(history.data.length, writes.length);
    assert.ok(history.data.every(row => row.pending === true));
    assert.deepEqual([...history.data].sort((a,b) => a.ordinal-b.ordinal).map(row => row.text), ["offline first", "offline second"].slice(0,writes.length));
    const receipts = await local.query(api.messageReceipts, { conversation });
    assert.ok(receipts.data.every(row => row.pending === true && row.receipt === null), JSON.stringify(receipts));
    const progress = await local.query(api.progress, { conversation });
    assert.deepEqual(progress.data.ahead, []); assert.deepEqual(progress.data.runs, []);
    assert.equal(progress.data.member.deliveredOrdinal, 0); assert.equal(progress.data.member.seenOrdinal, 0);
  }
  // A remote commit wins ordinal 1; the predictions must move on settlement.
  const other = await remote.mutate(api.send, { conversation, text: "remote first", photo: null });
  assert.equal(other.state, "sent", JSON.stringify(other));
  offline = false; await local.sync();
  await until(async () => !(await local.pendingWrites()).some(w => writes.includes(w.id)), "offline sends settle");
  await local.sync();
  const history = await local.query(api.history, { conversation });
  const rows = [...history.data].sort((a,b) => a.ordinal-b.ordinal);
  assert.deepEqual(rows.map(row => row.text), ["remote first", "offline first", "offline second"]);
  assert.deepEqual(rows.map(row => row.ordinal), [1,2,3]);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.ok(rows.every(row => !row.pending && row.recipients === 1));
  await remote.query(api.history, { conversation });
  await until(async () => { await local.sync(); const read = await local.query(api.messageReceipts, { conversation }); return read.data?.filter(row => row.id !== other.result).every(row => row.receipt === "delivered"); }, "offline sends delivered");
  assert.equal((await remote.mutate(api.seen, { conversation, through: 3 })).state, "sent");
  await until(async () => { await local.sync(); const read = await local.query(api.messageReceipts, { conversation }); return read.data?.filter(row => row.id !== other.result).every(row => row.receipt === "read"); }, "offline sends read");
});

// @ref LLP 3000.022#14.3 — wasm shares the receipt-derived maintenance boundary.
test("social starter wasm: receipt-derived unread badges leave sends pending in history", { timeout: hangBudget(30) }, async t => {
  const generated = starter(t);
  const schemaPath = join(generated, "snapback/schema.q");
  const source = readFileSync(schemaPath, "utf8") + `
view unreadCounts: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal
mutation sendNamed(conversation: conversations, text: text <=2000, id: id):
  insert messages { id, conversation, sender: viewer, text, photo: null, at: now }
query badges(conversation: conversations):
  return unreadCounts where .conversation = conversation first 50 by .id { member, value, recountPending }
`;
  writeFileSync(schemaPath, source);
  const checked = spawnSync(binary, ["check"], { cwd: generated, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const api = await generatedApi(generated);
  const { url } = await server(t, undefined, source);
  const signup = await fetch(`${url}/auth/signup`, { method: "POST", body: JSON.stringify({ email: "rp@example.com", password: "receipt-prediction-test" }) }).then(r => r.json());
  assert.ok(signup.session, JSON.stringify(signup));
  const session = signup.session;
  let offline = false;
  const local = await createLocalClient({ url, session,
    device: webDevice({ persist: memoryPersistence(), wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")) }),
    fetch: (input, init) => {
      if (offline) throw new TypeError("offline");
      return new URL(input).pathname === "/changes" ? parkedChanges(init.signal) : fetch(input, init);
    } });
  t.after(() => local.close());
  const remote = createClient({ url, token: session.token });
  t.after(() => remote.close());
  const created = await local.mutate(api.createConversation, { title: "receipt badge" });
  assert.equal(created.state, "sent", JSON.stringify(created));
  const conversation = created.result;
  const clean = await local.mutate(api.createConversation, { title: "unrelated badge" });
  assert.equal(clean.state, "sent");
  await local.sync(); offline = true; await local.sync();
  const writes = [];
  for (const text of ["one", "two", "three"]) {
    const write = text === "one"
      ? await local.mutate(api.sendNamed, { conversation, text, id: "" }, { waitSeconds: 0 })
      : await local.mutate(api.send, { conversation, text, photo: null }, { waitSeconds: 0 });
    assert.equal(write.state, "pending", JSON.stringify(write)); writes.push(write.id);
    const history = await local.query(api.history, { conversation });
    assert.equal(history.data.length, writes.length);
    assert.ok(history.data.every(row => row.pending === true));
    assert.ok(history.data.some(row => row.id === ""), "the empty-id prediction must also freeze the count");
    const badges = await local.query(api.badges, { conversation });
    assert.equal(badges.complete, false, JSON.stringify(badges));
    assert.deepEqual(badges.data.map(row => [row.value, row.recountPending]), [[0, true]]);
    const unrelated = await local.query(api.badges, { conversation: clean.result });
    assert.equal(unrelated.complete, true, JSON.stringify(unrelated));
    assert.deepEqual(unrelated.data.map(row => [row.value, row.recountPending]), [[0, false]]);
  }
  // Another device of this user allocates first, shifting all three positions.
  assert.equal((await remote.mutate(api.send, { conversation, text: "other device", photo: null })).state, "sent");
  offline = false; await local.sync();
  await until(async () => !(await local.pendingWrites()).some(w => writes.includes(w.id)), "receipt count queue settles");
  await local.sync();
  const history = await local.query(api.history, { conversation });
  assert.deepEqual([...history.data].sort((a,b) => a.ordinal-b.ordinal).map(row => [row.text, row.ordinal, !!row.pending]),
    [["other device", 1, false], ["one", 2, false], ["two", 3, false], ["three", 4, false]]);
  const badges = await local.query(api.badges, { conversation });
  assert.equal(badges.complete, true, JSON.stringify(badges));
  assert.deepEqual(badges.data.map(row => [row.value, row.recountPending]), [[4, false]]);
});
