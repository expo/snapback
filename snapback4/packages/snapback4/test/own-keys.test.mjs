import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.028#7.3 — sign-out keeps same-principal proof; a caller change cannot borrow it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalClient } from "../dist/local.js";
import { restoreSession } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { binary, server } from "./helpers/app-server.mjs";
import { parkedChanges } from "./helpers/sync-control.mjs";

const source = `use identity
table likes:
  post: id
  owner: principal
  at: time
  unique post, owner
  immutable post, owner
  public 'likes'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public last 2 by .at with own keys .owner
table notes:
  owner: principal
  body: text <=100
  read <- .owner = viewer
  sync to .owner
query own(post: id):
  return exists likes[post, viewer]
query note(id: notes):
  return notes[id]
`;
const own = { kind: "query", name: "own" };

for (const tier of ["native", "web"]) {
  test(`${tier}: sign-out preserves own-key proof for an offline same-store reopen, never another caller`, { timeout: hangBudget(25) }, async t => {
    const { url, dir } = await server(t, undefined, source);
    const signup = async email => {
      const result = await fetch(`${url}/auth/signup`, { method: "POST", body: JSON.stringify({ email, password: "a-test-password-long-enough" }) }).then(r => r.json());
      assert.ok(result.session, JSON.stringify(result));
      return result.session;
    };
    const alice = await signup("alice@example.com"), bob = await signup("bob@example.com");
    const seeded = await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify([
      { table: "likes", row: { id: "alice-old", post: "alice-old", owner: alice.principal, at: 1 } },
      { table: "likes", row: { id: "bob-old", post: "bob-old", owner: bob.principal, at: 2 } },
      { table: "likes", row: { id: "new1", post: "new1", owner: bob.principal, at: 3 } },
      { table: "likes", row: { id: "new2", post: "new2", owner: bob.principal, at: 4 } },
      { table: "notes", row: { id: "alice-note", owner: alice.principal, body: "private note" } },
    ]) }).then(r => r.json());
    assert.equal(seeded.seeded, 5, JSON.stringify(seeded));
    const opener = tier === "native" ? processDevice({ binary, dir: join(dir, "device") })
      : webDevice({ persist: memoryPersistence(), wasm: readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url)) });
    const saved = new Map();
    const sessionStore = {
      async get(key) { return saved.get(key) ?? null; },
      async set(key, value) { saved.set(key, value); },
      async delete(key) { saved.delete(key); },
    };
    let offline = false;
    const calls = [], answers = [], clients = [], requestedNames = [];
    const open = async session => {
      const client = await createLocalClient({ url, session, sessionStore,
        fetch: (input, init) => {
          if (offline) throw new TypeError("offline");
          if (new URL(input).pathname === "/changes") return parkedChanges(init.signal);
          return fetch(input, init);
        },
        device: { async open(name, backend) {
          requestedNames.push(name);
          // The normal SDK chooses a different name per principal. Deliberately
          // alias them to exercise the raw same-store caller boundary too.
          const core = await opener.open("same-store", backend);
          return { ...core, async call(request) {
            calls.push(request.op);
            const answer = await core.call(request);
            if (request.op === "query") answers.push(answer);
            return answer;
          } };
        } },
      });
      clients.push(client);
      return client;
    };
    t.after(async () => { for (const client of clients) await client.close(); });
    let client = await open(alice);
    await client.sync();
    assert.equal(client.acquired, true);
    const before = await client.residency();
    offline = true;
    await client.signOut();
    assert.equal(await restoreSession(url, sessionStore), null, "sign-out forgets the credential");
    assert.equal(client.viewer(), null);

    client = await open(alice);
    for (const [post, expected] of [["missing", false], ["alice-old", true]]) {
      const result = await client.query(own, { post });
      assert.equal(result.data, expected, JSON.stringify(result));
      assert.equal(result.complete, true);
      assert.equal(result.fresh, false);
      assert.equal(answers.at(-1).ok.unknown, false);
    }
    assert.deepEqual((await client.residency()).tables, before.tables);
    await client.signOut();

    client = await open(bob);
    for (const post of ["missing", "bob-old"]) {
      const result = await client.query(own, { post });
      assert.equal(result.denied?.code, "E_OFFLINE", JSON.stringify(result));
      assert.equal(result.data, undefined, "unknown must never be published as false");
      assert.equal(answers.at(-1).ok.unknown, true);
    }
    const foreignNote = await client.query({ kind: "query", name: "note" }, { id: "alice-note" });
    const switched = await client.residency();
    await client.close();
    client = await open(alice);
    assert.equal((await client.query(own, { post: "missing" })).data, false);
    assert.ok(!calls.includes("clear_rows"), "sign-out does not delete replica data or outbox");
    assert.equal(new Set(requestedNames).size, 2, "ordinary SDK store names already isolate principals");

    // Store-wide counters retain both kinds of private data when an adapter
    // deliberately reuses the store. Pin the ordinary-table control beside it.
    assert.equal(switched.tables.notes.rows, 1);
    assert.equal(switched.tables.likes.rows, 2);
    assert.equal(switched.tables["$ownKeys:likes"]?.rows, 1);
    assert.ok(switched.tables["$ownKeys:likes"].bytes > 0);
    assert.deepEqual(switched.tables, before.tables);
    t.diagnostic(JSON.stringify({ tier, samePrincipalMissing: false, samePrincipalComplete: true,
      otherPrincipalUnknown: true, storeWideCounts: switched.tables, ordinaryRowOnAliasedStore: foreignNote }));
  });
}
