// Black-box state machine: real createApp/Client, a deterministic wire server,
// and a single-key-atomic store. No app implementation helpers are imported.
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { createApp } from "../../dist/app.js";
import { sessionKey } from "../../dist/auth.js";

export const operations = ["signup", "login", "guest", "refresh", "logout", "close", "reopen", "release", "query"];
export function generate(seed, length = 24) {
  let x = seed >>> 0;
  const choose = n => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  return [{ op: "guest", app: 0 }, { op: "reopen", app: 1 }, ...Array.from({ length }, () => ({
    op: operations[choose(operations.length)], app: choose(3), account: choose(2),
    hold: choose(5) === 0, fault: choose(3) === 0 ? { kind: ["get", "set", "delete"][choose(3)], at: 1 + choose(12) } : null,
  }))];
}
export async function execute(commands, coverage = {}) {
  const url = "https://session-model.invalid", key = sessionKey(url), values = new Map();
  const live = new Map(), minted = new Map(), parents = new Map(), accounts = new Set(), holds = [], tasks = [], apps = [];
  const errors = [], observed = new Map(), identities = [];
  let runtimeSerial = 0;
  let serial = 0, active, fault, hits = 0;
  const record = () => { try { return JSON.parse(values.get(key) ?? "null"); } catch { return null; } };
  const epoch = () => {
    const embedded = BigInt(record()?.snapback4Epoch ?? record()?.snapback4Logout ?? "0");
    const legacy = BigInt(values.get(key + ".epoch") ?? "0");
    return String(embedded > legacy ? embedded : legacy);
  };
  const count = name => { coverage[name] = (coverage[name] ?? 0) + 1; };
  const invariant = (id, ok, detail) => { if (!ok) errors.push(`${id}: ${detail}`); };
  function inject(kind, k) {
    count(`storage.${kind}.${k === key ? "session" : k.endsWith(".epoch") ? "epoch" : k.endsWith(".revocations") ? "retirement" : "writes"}`);
    if (fault?.kind === kind && ++hits === fault.at) { count(`fault.${kind}`); count(`fault.${kind}.${hits}`); throw Error(`injected ${kind} #${hits}`); }
  }
  const store = id => ({
    async get(k) { inject("get", k); if (k === key) observed.set(id, epoch()); return values.get(k) ?? null; },
    async set(k, value) {
      inject("set", k);
      const before = record(), priorEpoch = BigInt(epoch());
      values.set(k, value);
      if (k === key || k === key + ".epoch") {
        const after = record(), nextEpoch = BigInt(epoch());
        let ancestor = after?.token;
        while (ancestor && ancestor !== before?.token) ancestor = parents.get(ancestor);
        const rotation = Boolean(before?.token && ancestor === before.token);
        const replacement = Boolean(before?.token && after?.token && before.token !== after.token && !rotation);
        if (nextEpoch !== priorEpoch) invariant("I5", nextEpoch === priorEpoch + 1n && (replacement || after?.snapback4Logout !== undefined), "epoch changed outside an atomic replacement/logout commit");
        if (replacement) invariant("I5", nextEpoch === priorEpoch + 1n, "replacement reused the prior epoch");
      }
    },
    async delete(k) { inject("delete", k); values.delete(k); },
  });
  function issue(principal) {
    const session = { principal, token: `token-${++serial}`, kind: "user", expiresAt: Date.now() + 7 * 86400000 };
    live.set(session.token, principal); minted.set(session.token, session); return session;
  }
  const denied = () => Response.json({ denied: { code: "E_AUTH", family: "auth", message: "refused" } }, { status: 401 });
  const fetcher = (id, slot) => async (input, init) => {
    const path = new URL(input).pathname, token = new Headers(init?.headers).get("authorization")?.slice(7);
    count(`wire.${path}`);
    let session;
    if (path === "/auth/guest") session = issue(`guest:${serial + 1}`);
    else if (path === "/auth/signup" || path === "/auth/login") {
      const email = JSON.parse(init.body).email;
      if (path.endsWith("signup")) accounts.add(email);
      if (!accounts.has(email)) return denied();
      session = issue(`user:${email}`);
    } else if (path === "/auth/refresh") {
      if (!live.has(token)) return denied();
      const principal = live.get(token); live.delete(token); session = issue(principal);
      parents.set(session.token, token);
    } else if (path === "/auth/logout") {
      invariant("I1", record()?.token !== token, `revoking stored ${token}`);
      live.delete(token);
      if (active?.hold && active.app === slot) {
        count(`held.${path}`);
        await new Promise(resolve => holds.push({ id: slot, token, resolve }));
      }
      return Response.json({ ok: true });
    } else if (path.startsWith("/q/")) {
      if (!live.has(token)) return denied();
      if (observed.get(id) === epoch()) invariant("I4", live.get(token) === record()?.principal,
        `app ${id} read as ${live.get(token)} while store is ${record()?.principal}`);
      return Response.json({ data: [{ principal: live.get(token) }], seq: 0, complete: true });
    } else throw Error(`unexpected model request ${path}`);
    const owner = active;
    if (owner?.hold && owner.app === slot) {
      count(`held.${path}`);
      await new Promise(resolve => holds.push({ id: slot, token: session.token, resolve }));
    }
    return Response.json({ session });
  };
  const track = (id, promise, op, before) => {
    const task = { id, op, before, pending: true };
    tasks.push(task);
    task.promise = Promise.resolve(promise).then(result => { task.result = result; }, error => { task.result = { ok: false, error: String(error) }; }).finally(() => { task.pending = false; });
    return task;
  };
  async function settle() { for (let n = 0; n < 4; n++) await tick(); }
  const open = slot => {
    const id = ++runtimeSerial; identities[slot] = id;
    const app = createApp({ url, sessionStore: store(id), fetch: fetcher(id, slot) });
    apps[slot] = app; return app.ready;
  };
  function check() {
    if (errors.length) assert.fail(errors[0]);
    const journal = (() => { try { return JSON.parse(values.get(key + ".revocations") ?? "null")?.tokens ?? []; } catch { return []; } })();
    const held = new Set([record()?.token, ...journal, ...(record()?.snapback4Retired ?? []), ...holds.map(h => h.token)]);
    for (const app of apps) held.add(app?.client.session()?.token);
    for (const [id, app] of apps.entries()) {
      if (!tasks.some(t => t.pending && t.id === id)) invariant("I4", app.auth.state !== "restoring", `app ${id} stuck restoring without an operation`);
      if (observed.get(identities[id]) === epoch() && app.auth.state === "signed-in") invariant("I4", app.auth.viewer === record()?.principal,
        `app ${id} exposes ${app.auth.viewer} after observing stored ${record()?.principal}`);
    }
    // A response/opening still in flight owns its minted sessions until it
    // commits or aborts. At quiescence, every remaining live token needs custody.
    if (!tasks.some(t => t.pending)) for (const token of live.keys()) invariant("I3", held.has(token), `unowned live ${token}`);
    if (errors.length) assert.fail(errors[0]);
  }
  try {
    for (let id = 0; id < 3; id++) await open(id);
    for (const command of commands) {
      active = command; fault = command.fault; hits = 0; count(`op.${command.op}`);
      const { app: id, op } = command, app = apps[id];
      const before = { bytes: values.get(key), epoch: epoch(), concurrent: tasks.some(t => t.pending) };
      let promise;
      if (op === "release") { const held = holds.shift(); held?.resolve(); }
      else if (op === "reopen") {
        if (!tasks.some(t => t.pending && t.id === id)) { await app?.close(); promise = open(id); }
      } else if (op === "close") promise = app?.close();
      else if (op === "refresh") promise = app?.client.refreshSession();
      else if (op === "query") promise = app?.client.query({ kind: "query", name: "viewer" }, {});
      else if (op === "guest" || op === "logout") promise = app?.auth[op]();
      else promise = app?.auth[op](`account${command.account ?? 0}@example.com`, "password");
      const task = promise && track(id, promise, op, before);
      await settle(); fault = null; active = undefined;
      if (task && !task.pending && task.result?.ok === false && !before.concurrent) {
        const tombstone = record()?.snapback4Logout !== undefined;
        invariant("I2", values.get(key) === before.bytes || tombstone, `${op} failed but session bytes changed`);
        invariant("I5", epoch() === before.epoch || tombstone, `${op} failed but epoch ${before.epoch} -> ${epoch()}`);
      }
      check();
    }
    fault = null; active = undefined;
    while (holds.length) holds.shift().resolve();
    await settle(); await Promise.all(tasks.map(t => t.promise));
    // Fair recovery: storage/network work again and all responses arrive. Each
    // runtime gets a successful logout retry, then restart drains durable work.
    for (const app of apps) { await app.auth.logout(); await settle(); }
    for (const app of apps) await app.close();
    await open(0); await apps[0].auth.logout(); await settle(); check();
    invariant("I3", live.size === 0, `live after recovery: ${[...live.keys()]}`);
    const journal = values.get(key + ".revocations");
    invariant("retirement", !journal || JSON.parse(journal).tokens.length === 0, "acknowledged journal entries remain");
    invariant("retirement", !record()?.snapback4Retired?.length, "acknowledged tombstone entries remain");
    check();
  } finally {
    fault = null; active = undefined;
    while (holds.length) holds.shift().resolve();
    await settle();
    for (const app of apps) await app?.close();
  }
}

// Deletion-minimal counterexample, replayed with the same deterministic wire
// and fault indices. Keep the invariant identity while removing commands.
export async function minimize(commands, failure) {
  const identity = failure.message.match(/(?:I[1-5]|retirement):/)?.[0] ?? failure.message;
  let minimal = commands;
  for (let i = 0; i < minimal.length;) {
    const candidate = minimal.filter((_, index) => index !== i);
    try { await execute(candidate); i++; }
    catch (error) { if (error.message.includes(identity)) { minimal = candidate; i = 0; } else i++; }
  }
  return minimal;
}
