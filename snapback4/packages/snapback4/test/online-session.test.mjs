import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient, mintId } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { memorySessionStore } from "../dist/auth.js";

const session = (token, expiresAt = Date.now() + 7 * 86400_000) => ({ principal: "user:alice", kind: "user", token, expiresAt });
const denied = () => Response.json({ denied: { code: "E_AUTH", family: "auth", message: "session ended" } }, { status: 401 });
const bearer = init => new Headers(init.headers).get("authorization");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const query = { kind: "query", name: "read" };

async function localPersona() {
  const backend = { generation: 1, schema: { tables: {} }, programs: [] };
  return createLocalClient({ url: "https://card.invalid", persona: "alice", sessionStore: memorySessionStore(),
    device: { open: async () => ({ async close() {}, async call({ op }) {
      if (op === "sync_state") return { ok: { acquired: false, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [] } };
      if (op === "state") return { ok: { watermark: 0, generation: 1, native: null } };
      if (op === "backend") return { ok: backend };
      if (op === "queued") return { ok: [] };
      if (op === "meta") return { ok: null };
      if (op === "apply") return { ok: { touched: [] } };
      return { ok: true };
    } }) },
    fetch: async (url, init) => {
      if (new URL(url).pathname === "/schema") return Response.json(backend);
      if (new URL(url).pathname === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [] });
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    },
  });
}

test("README client card members are functions on both tiers, except device-only sync", async t => {
  const readme = ["README.md", "CLIENT-AND-OPERATIONS.md"].map(name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8")).join("\n");
  const card = readme.match(/has `query\(op, args\)[\s\S]*?`close\(\)`\./)?.[0];
  assert.ok(card, "the README client member list must remain discoverable");
  // Each code span names one client member; observe's nested return methods are not client members.
  const members = [...card.replace(/\(a live read;[\s\S]*?shape\),/, "").matchAll(/`([a-zA-Z]\w*)[^`]*`/g)].map(match => match[1]);
  assert.ok(members.includes("session") && members.includes("observe") && members.includes("close"));
  const deviceOnly = ["sync"];
  const local = await localPersona();
  const online = createClient({ url: "https://card.invalid", persona: "alice" });
  t.after(async () => { await local.close(); await online.close(); });
  const missing = [];
  for (const member of members) {
    if (typeof local[member] !== "function") missing.push(`local.${member}`);
    if (!deviceOnly.includes(member) && typeof online[member] !== "function") missing.push(`online.${member}`);
  }
  t.diagnostic(`${members.length} README members; ${deviceOnly.length} device-only; ${missing.length} missing implementations`);
  assert.deepEqual(missing, []);
  assert.equal(local.session(), null);
  assert.equal(online.session(), null);
  for (const client of [local, online]) {
    assert.equal((await client.refreshSession()).why.code, "E_AUTH");
    assert.equal((await client.logoutAll()).why.code, "E_AUTH");
  }
});

for (const credential of ["session", "token"]) {
  test(`online ${credential}: rotation adopts the bearer before notification; revocation closes`, async t => {
    const old = session("old");
    const next = session("next");
    const calls = [];
    let offline = false;
    const client = createClient({ url: "https://session.invalid", [credential]: credential === "session" ? old : old.token,
      fetch: async (url, init) => {
        const path = new URL(url).pathname;
        calls.push([path, bearer(init)]);
        if (offline) throw new Error("offline");
        if (path === "/auth/refresh") return Response.json({ session: next });
        if (path === "/auth/logout-all") return Response.json({ ok: true, revoked: 2 });
        return Response.json({ data: 42, viewer: old.principal });
      },
    });
    t.after(() => client.close());
    assert.deepEqual(client.session(), credential === "session" ? old : null);
    const observed = [];
    client.onSession(value => {
      observed.push(value);
      assert.deepEqual(client.session(), value);
      assert.equal(client.assetSource("photo").headers.authorization, value ? `Bearer ${value.token}` : undefined);
    });
    const ignored = [];
    client.onSession(value => ignored.push(value))();
    assert.deepEqual(await client.refreshSession(), { ok: true, session: next });
    assert.equal(client.viewer(), next.principal);
    assert.equal((await client.query(query, {})).data, 42);
    offline = true;
    assert.equal((await client.logoutAll()).why.code, "E_OFFLINE");
    assert.deepEqual(client.session(), next, "offline revocation retains the retryable session");
    offline = false;
    assert.deepEqual(await client.logoutAll(), { ok: true, revoked: 2 });
    assert.equal(client.session(), null);
    assert.equal(client.viewer(), null);
    assert.equal(client.link(), "signed-out");
    assert.deepEqual(observed, [next, null]);
    assert.deepEqual(ignored, []);
    assert.equal((await client.query(query, {})).denied.code, "E_CLOSED");
    assert.equal((await client.refreshSession()).why.code, "E_CLOSED");
    assert.deepEqual(calls, [["/auth/refresh", "Bearer old"], ["/q/read", "Bearer next"], ["/auth/logout-all", "Bearer next"], ["/auth/logout-all", "Bearer next"]]);
  });
}

test("online session: signOut clears the session and notifies once", async t => {
  const calls = [];
  const client = createClient({ url: "https://signout.invalid", session: session("old"), fetch: async (url, init) => { calls.push(bearer(init)); return Response.json({ ok: true }); } });
  t.after(() => client.close());
  const observed = [];
  client.onSession(value => observed.push(value));
  await client.signOut();
  await client.signOut();
  assert.equal(client.session(), null);
  assert.deepEqual(observed, [null]);
  assert.deepEqual(calls, ["Bearer old"]);
});

test("online session: current refusal clears the session; an obsolete refusal retries the same write id", async t => {
  const entered = deferred(), release = deferred();
  const ids = [], bearers = [], outcomes = [];
  const client = createClient({ url: "https://race.invalid", session: session("old"), fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/auth/refresh") return Response.json({ session: session("next") });
    if (path === "/m/write") {
      ids.push(JSON.parse(init.body).id); bearers.push(bearer(init));
      if (ids.length === 1) { entered.resolve(); await release.promise; return denied(); }
      return Response.json({ state: "sent", seq: 1, result: 42 });
    }
    return denied();
  } });
  t.after(() => { release.resolve(); return client.close(); });
  client.onWrite(outcome => outcomes.push(outcome));
  const writing = client.mutate({ kind: "mutation", name: "write" }, {});
  await entered.promise;
  assert.equal((await client.refreshSession()).ok, true);
  release.resolve();
  assert.equal((await writing).state, "sent");
  assert.deepEqual(bearers, ["Bearer old", "Bearer next"]);
  assert.equal(ids[0], ids[1]);
  assert.equal(outcomes.length, 1);
  assert.equal(client.session().token, "next");
  const observed = [];
  client.onSession(value => observed.push(value));
  assert.equal((await client.query(query, {})).denied.code, "E_AUTH");
  assert.equal(client.session(), null);
  assert.deepEqual(observed, [null]);
});

test("online session: near-expiry rotates before a protected read; concurrent refreshes coalesce", async t => {
  const release = deferred();
  let refreshes = 0;
  const client = createClient({ url: "https://expiry.invalid", session: session("old", Date.now() + 1000), fetch: async (url, init) => {
    if (new URL(url).pathname === "/auth/refresh") { refreshes++; await release.promise; return Response.json({ session: session("next") }); }
    assert.equal(bearer(init), "Bearer next");
    return Response.json({ data: true });
  } });
  t.after(() => { release.resolve(); return client.close(); });
  const reading = client.query(query, {});
  const first = client.refreshSession(), second = client.refreshSession();
  release.resolve();
  assert.equal((await reading).data, true);
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(refreshes, 1);
});

test("online session: a refresh cannot change principal or resurrect a closed client", async t => {
  for (const close of [false, true]) {
    const entered = deferred(), release = deferred();
    const client = createClient({ url: "https://principal.invalid", session: session("old"), fetch: async () => {
      entered.resolve(); await release.promise;
      return Response.json({ session: { ...session("next"), principal: close ? "user:alice" : "user:bob" } });
    } });
    t.after(() => { release.resolve(); return client.close(); });
    const observed = [];
    client.onSession(value => observed.push(value));
    const refreshing = client.refreshSession();
    await entered.promise;
    const closing = close ? client.close() : undefined;
    release.resolve();
    assert.equal((await refreshing).why.code, close ? "E_CLOSED" : "E_AUTH");
    await closing;
    assert.notEqual(client.session()?.token, "next");
    assert.deepEqual(observed, close ? [] : [null]);
  }
});

test("online assets revoke late credential-bound URLs across rotation, sign-out and close", async t => {
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let serial = 0;
  const revoked = [];
  URL.createObjectURL = () => `blob:asset-${++serial}`;
  URL.revokeObjectURL = url => revoked.push(url);
  t.after(() => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; });

  for (const ending of ["close", "sign-out"]) {
    const entered = deferred(), release = deferred();
    const client = createClient({ url: "https://asset.invalid", session: session("old"), fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/auth/logout") return Response.json({ ok: true });
      entered.resolve(); await release.promise;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    } });
    const reading = client.asset("photo");
    await entered.promise;
    await (ending === "close" ? client.close() : client.signOut());
    release.resolve();
    const result = await reading;
    assert.equal(result.denied?.code, "E_CLOSED");
  }
  assert.deepEqual(revoked, ["blob:asset-1", "blob:asset-2"]);

  const oldEntered = deferred(), oldRelease = deferred();
  const bearers = [];
  const client = createClient({ url: "https://asset.invalid", session: session("old"), fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/auth/refresh") return Response.json({ session: session("next") });
    bearers.push(bearer(init));
    if (bearers.length === 1) { oldEntered.resolve(); await oldRelease.promise; }
    return new Response(new Uint8Array([4]), { headers: { "content-type": "image/png" } });
  } });
  t.after(() => client.close());
  const reading = client.asset("photo");
  await oldEntered.promise;
  assert.equal((await client.refreshSession()).ok, true);
  oldRelease.resolve();
  const result = await reading;
  assert.deepEqual(bearers, ["Bearer old", "Bearer next"]);
  assert.equal(result.url, "blob:asset-4");
  assert.deepEqual(revoked, ["blob:asset-1", "blob:asset-2", "blob:asset-3"]);
  result.revoke();
});

test("mintId keeps burst and rollback ids monotonic without advancing their timestamp", () => {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const timestamp = id => [...id.slice(0, 10)].reduce((value, digit) => value * 32 + alphabet.indexOf(digit), 0);
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000_0000]) assert.throws(() => mintId(invalid), RangeError);
  const now = Date.now() + 1_000_000;
  const ids = Array.from({ length: 10_000 }, () => mintId(now));
  ids.push(mintId(now - 10_000));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ids);
  assert.ok(ids.every(id => timestamp(id) === now), "entropy ordering must not fabricate future wall-clock milliseconds");
});

test("mintId refuses entropy-field exhaustion without poisoning a later millisecond", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues(bytes) { bytes.fill(255); return bytes; } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "crypto", previous) : delete globalThis.crypto);
  const isolated = await import(`../dist/client.js?entropy-exhaustion=${Date.now()}`);
  const now = Date.now();
  isolated.mintId(now);
  assert.throws(() => isolated.mintId(now), /exhausted 80-bit entropy/);
  assert.doesNotThrow(() => isolated.mintId(now + 1));
});

test("mintId does not publish timestamp state when secure entropy throws", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues() { throw new Error("entropy unavailable"); } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "crypto", previous) : delete globalThis.crypto);
  const isolated = await import(`../dist/client.js?entropy-throw=${Date.now()}`);
  const now = Date.now();
  assert.throws(() => isolated.mintId(now), /entropy unavailable/);
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues(bytes) { bytes.fill(0); return bytes; } } });
  assert.doesNotThrow(() => isolated.mintId(now));
});
