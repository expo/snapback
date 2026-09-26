// Probe (not a suite test): peer-observable liveness in the Clique M3 shape.
// Measures, per tier, how long one client's write takes to reach another
// client's live observation: a membership watermark, a typing row, and a
// just-added member's inbox, history and next message.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 10);
const LIMIT = Number(process.env.PROBE_LIMIT_MS ?? 15000);

async function waitFor(check, ms = LIMIT) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return Date.now() - start;
    if (Date.now() - start >= ms) return null;
    await sleep(10);
  }
}

const schema = `use personas alice, bob, dave
use identity

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  creatorId: principal
  lastOrdinal: int default 0
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer]
  delete <- deny
  after insert <- exists memberships[conversationId = .id, principal = .creatorId]
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  deliveredOrdinal: int default 0
  readOrdinal: int default 0
  unique conversationId, principal
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin'] or created conversations[.conversationId]
  update <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  ordinal: int
  body: text <=2000 ?
  at: time
  unique conversationId, ordinal
  immutable conversationId, authorId, ordinal, at
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId] last 500 by .ordinal

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- .principal = viewer
  expire at .expiresAt
  sync to memberships[.conversationId]

query inbox(c: cursor ?):
  return memberships where .principal = viewer first 50 by .conversationId after c { conversationId, role, deliveredOrdinal, readOrdinal }

query membersOf(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships where .conversationId = conversationId

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages where .conversationId = conversationId last 50 by .ordinal after c

query typingNow(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return typing where .conversationId = conversationId { principal, expiresAt }

mutation createGroup(name: text 1..50, other: principal):
  c = insert conversations { kind: 'group', title: name, creatorId: viewer }
  insert memberships { conversationId: c.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: c.id, principal: other, role: 'member', joinedAt: now }
  return { id: c.id }

mutation addMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  insert memberships { conversationId, principal, role: 'member', joinedAt: now } if absent
  return null

mutation send(conversationId: conversations, body: text <=2000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  conversation = conversations[conversationId] ! else NOT_FOUND
  ordinal = conversation.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  row = insert messages { conversationId, authorId: viewer, ordinal, body, at: now }
  return { id: row.id, ordinal }

mutation setTyping(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 4500 }
  return null

mutation markDelivered(conversationId: conversations, ordinal: int):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  if ordinal > membership.deliveredOrdinal:
    update memberships[membership] { deliveredOrdinal: ordinal }
  return null
`;

async function server(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-peer-probe-"));
  mkdirSync(join(dir, "snapback")); mkdirSync(join(dir, "devices"));
  writeFileSync(join(dir, "snapback/schema.q"), schema);
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", d => { log += d; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", d => { log += d; });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close().catch(() => {}); child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  if (!await waitFor(() => { if (child.exitCode != null) throw new Error(log); return url; }, 30000)) throw new Error("no url: " + log);
  const native = processDevice({ binary, dir: join(dir, "devices"), spawn: (c, a) => spawn(c, a, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (p, s) => writeFileSync(p, s) });
  const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
  const open = async (tier, persona) => {
    const options = { url, persona, waitSeconds: 25 };
    const client = tier === "online" ? createClient(options)
      : await createLocalClient({ ...options, device: tier === "native" ? native : webDevice({ wasm, persist: memoryPersistence() }) });
    clients.push(client);
    if (tier !== "online") await client.sync();
    return client;
  };
  return { url, open, log: () => log };
}

const snap = watch => watch.getSnapshot();
const rows = watch => { const s = snap(watch); return Array.isArray(s?.data) ? s.data : Array.isArray(s?.data?.items) ? s.data.items : []; };
const stats = xs => { const ok = xs.filter(x => x != null).sort((a, b) => a - b); return { n: xs.length, missed: xs.filter(x => x == null).length, p50: ok[Math.floor(ok.length / 2)] ?? null, max: ok.at(-1) ?? null }; };

for (const tier of (process.env.PROBE_TIERS ?? "online,native,web").split(",")) test(`peer liveness: ${tier}`, { timeout: 600000 }, async t => {
  const s = await server(t);
  const alice = await s.open(tier, "alice"), bob = await s.open(tier, "bob"), dave = await s.open(tier, "dave");
  const q = name => ({ kind: "query", name }), m = name => ({ kind: "mutation", name });
  const created = await alice.mutate(m("createGroup"), { name: "probe", other: "dev:bob" });
  assert.equal(created.state, "sent", JSON.stringify(created));
  const c = created.value?.id ?? created.result?.id;
  assert.ok(c, JSON.stringify(created));
  // 1. A peer's watermark reaches another client's membersOf.
  const members = alice.observe(q("membersOf"), { conversationId: c });
  t.after(() => members.close());
  await waitFor(() => rows(members).length === 2, 30000);
  const watermark = [];
  for (let n = 1; n <= ROUNDS; n++) {
    await bob.mutate(m("markDelivered"), { conversationId: c, ordinal: n });
    watermark.push(await waitFor(() => rows(members).some(r => r.principal === "dev:bob" && r.deliveredOrdinal === n)));
  }
  // 2. Typing appears on the peer, then expires.
  const typing = alice.observe(q("typingNow"), { conversationId: c });
  t.after(() => typing.close());
  const typed = [], expired = [];
  for (let n = 1; n <= Math.min(ROUNDS, 3); n++) {
    await bob.mutate(m("setTyping"), { conversationId: c });
    typed.push(await waitFor(() => rows(typing).some(r => r.principal === "dev:bob")));
    expired.push(await waitFor(() => !rows(typing).some(r => r.principal === "dev:bob"), 12000));
  }
  // 3. A just-added member: inbox, full history, then the next live message.
  for (let n = 1; n <= 3; n++) await alice.mutate(m("send"), { conversationId: c, body: `before ${n}` });
  const inbox = dave.observe(q("inbox"), {});
  t.after(() => inbox.close());
  await alice.mutate(m("addMember"), { conversationId: c, principal: "dev:dave" });
  const joined = await waitFor(() => rows(inbox).some(r => r.conversationId === c));
  const thread = dave.observe(q("thread"), { conversationId: c });
  t.after(() => thread.close());
  const history = await waitFor(() => rows(thread).filter(r => r.body?.startsWith("before")).length === 3);
  const next = [];
  for (let n = 1; n <= ROUNDS; n++) {
    await alice.mutate(m("send"), { conversationId: c, body: `after ${n}` });
    next.push(await waitFor(() => rows(thread).some(r => r.body === `after ${n}`)));
  }
  const report = { tier, watermark: stats(watermark), typing: stats(typed), typingExpired: stats(expired), joinedInbox: joined, history, nextMessage: stats(next),
    lastSnapshots: { members: snap(members), thread: { ...snap(thread), data: undefined, rows: rows(thread).length } } };
  t.diagnostic(JSON.stringify(report));
  console.log("PROBE " + JSON.stringify(report));
});
