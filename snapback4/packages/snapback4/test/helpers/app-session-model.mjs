// Black-box state machine: real createApp/Client, a deterministic wire server,
// and a single-key-atomic store. No app implementation helpers are imported.
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { createApp } from "../../dist/app.js";
import { sessionKey } from "../../dist/auth.js";

export const operations = ["signup", "login", "guest", "refresh", "logout", "close", "reopen", "release", "query", "logoutEverywhere", "revoke", "reopenOffline", "holdStore", "closeClient", "capture", "handleQuery", "handleMutate", "handleRefresh", "observeHandle", "readObservation", "refreshFault", "revokeCurrent"];
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
  const acknowledgedGlobal = new Set();
  const live = new Map(), minted = new Map(), parents = new Map(), accounts = new Set(), holds = [], tasks = [], apps = [];
  const errors = [], observed = new Map(), identities = [], publishedTokens = new Map(), privateRetries = new Map(), refusedAtOpen = new Map(), refused = new Set(), offline = new Set();
  const handles = [], observations = [], rotationFaults = new Set();
  let holdStore = false;
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
      if (holdStore) { holdStore = false; count("held.storage.set"); await new Promise(resolve => holds.push({ resolve, storage: true, value, runtime: id })); }
      inject("set", k);
      if (k === key && rotationFaults.has(id) && parents.has(JSON.parse(value).token)) {
        rotationFaults.delete(id); count("fault.rotationSave"); throw Error("one rotation save failed");
      }
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
  const denied = token => { for (let value = token; value; value = parents.get(value)) refused.add(value); return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "refused" } }, { status: 401 }); };
  const fetcher = (id, slot) => async (input, init) => {
    const path = new URL(input).pathname, token = new Headers(init?.headers).get("authorization")?.slice(7);
    count(`wire.${path}`);
    if (offline.has(id)) { count("wire.offline"); throw Error("model is offline"); }
    let session;
    if (path === "/auth/guest") session = issue(`guest:${serial + 1}`);
    else if (path === "/auth/signup" || path === "/auth/login") {
      const email = JSON.parse(init.body).email;
      if (path.endsWith("signup")) accounts.add(email);
      if (!accounts.has(email)) return denied();
      session = issue(`user:${email}`);
    } else if (path === "/auth/refresh") {
      if (!live.has(token)) return denied(token);
      const principal = live.get(token); live.delete(token); session = issue(principal);
      parents.set(session.token, token);
    } else if (path === "/auth/logout-all") {
      invariant("I1", record()?.token !== token, `globally revoking stored ${token}`);
      if (!live.has(token)) return denied(token);
      const principal = live.get(token); let revoked = 0;
      for (const [value, owner] of live) if (owner === principal) { live.delete(value); revoked++; }
      if (active?.hold && active.app === slot) { count(`held.${path}`); await new Promise(resolve => holds.push({ id: slot, token, resolve })); }
      acknowledgedGlobal.add(token);
      return Response.json({ ok: true, revoked });
    } else if (path === "/auth/logout") {
      invariant("I1", record()?.token !== token, `revoking stored ${token}`);
      live.delete(token);
      if (active?.hold && active.app === slot) {
        count(`held.${path}`);
        await new Promise(resolve => holds.push({ id: slot, token, resolve }));
      }
      return Response.json({ ok: true });
    } else if (path === "/changes") {
      // Real observations long-poll. Keep the mock idle until its lifetime is
      // cancelled; this avoids inventing a fast polling loop in the generator.
      return new Promise(resolve => {
        const stop = () => resolve(Response.json({ seq: 0, tables: [] }));
        if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener("abort", stop, { once: true });
      });
    } else if (path === "/probe") return live.has(token) ? Response.json({ ok: true }) : denied(token);
    else if (path.startsWith("/m/")) {
      if (!live.has(token)) return denied(token);
      invariant("I8", !JSON.parse(init.body).args?.hiddenHandle, "hidden handle dispatched a write");
      count("wire.handleWrite");
      if (active?.hold && active.app === slot) {
        count(`held.${path}`); await new Promise(resolve => holds.push({ id: slot, token, resolve }));
      }
      return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: 1 });
    } else if (path.startsWith("/q/")) {
      invariant("I8", !JSON.parse(init.body).args?.hiddenHandle, "hidden handle dispatched a read");
      if (!live.has(token)) return denied(token);
      if (observed.get(id) === epoch()) invariant("I4", live.get(token) === record()?.principal,
        `app ${id} read as ${live.get(token)} while store is ${record()?.principal}`);
      const data = [{ principal: live.get(token) }];
      if (active?.hold && active.app === slot) {
        count(`held.${path}`); await new Promise(resolve => holds.push({ id: slot, token, resolve }));
      }
      return Response.json({ data, seq: 0, complete: true });
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
    task.promise = Promise.resolve(promise).then(result => {
      task.result = result;
      // A failed global logout may hide, but privately retain, the client it
      // selected. This capability is checked through subsequent retry/close;
      // fair recovery must still leave no live token on the mock server.
      if (op === "logoutEverywhere") {
        if (!result.ok && before.token) privateRetries.set(id, before.token);
        else if (result.ok) privateRetries.delete(id);
      }
      if (op === "close" || op === "closeClient" || op === "reopen" || op === "reopenOffline") privateRetries.delete(id);
    }, error => { task.result = { ok: false, error: String(error) }; }).finally(() => { task.pending = false; });
    return task;
  };
  async function settle() { for (let n = 0; n < 4; n++) await tick(); }
  function checkPublished(app, id, publication = false) {
    const { state, viewer } = app.auth, client = app.client;
    if (state === "signed-out") invariant("I6", viewer === null && client.viewer() === null && client.session() === null, `signed-out runtime ${id} exposes a live client`);
    if (state === "signed-in") {
      invariant("I6", viewer !== null && viewer === client.viewer() && viewer === client.session()?.principal && client.link() !== "signed-out", `signed-in runtime ${id} disagrees with its client`);
      if (publication && publishedTokens.get(id) !== client.session()?.token) invariant("I7", !refusedAtOpen.get(id)?.has(client.session()?.token), `runtime ${id} restored refused ${client.session()?.token}`);
      if (observed.get(id) === epoch()) invariant("I4", viewer === record()?.principal, `runtime ${id} published ${viewer} after observing ${record()?.principal}`);
    }
    if (publication) publishedTokens.set(id, state === "signed-in" ? client.session()?.token : undefined);
  }
  function checkHandles() {
    for (const h of handles) {
      if (!h.principal) continue;
      if (!h.hidden && (h.app.auth.state !== "signed-in" || h.app.client !== h.client)) { h.hidden = true; count("handle.hidden"); }
      if (h.hidden) invariant("I8", h.client.viewer() === null && h.client.session() === null && !h.client.acquired,
        `retained handle for ${h.principal} still exposes its hidden identity`);
    }
    for (const entry of observations) {
      const read = entry.observed.getSnapshot();
      if (entry.handle.hidden) invariant("I8", !("data" in read), `observation retained data for hidden ${entry.handle.principal}`);
      if ("data" in read) { entry.hadData = true; count("observation.data"); }
      if (entry.handle.hidden && entry.hadData && !entry.countedHidden) { entry.countedHidden = true; count("observation.hidden"); }
    }
  }
  const capture = (app, slot) => {
    const handle = { app, slot, client: app.client, principal: app.client.viewer(), hidden: false };
    handles.push(handle); count("handle.captured");
    handle.stops = [
      handle.client.onSession(session => {
        checkHandles(); count("handle.sessionNotification");
        invariant("I8", !handle.hidden || session === null, "hidden handle published a session credential");
      }),
      handle.client.onViewer(viewer => {
        checkHandles(); count("handle.viewerNotification");
        invariant("I8", !handle.hidden || viewer === null, "hidden handle published a viewer");
      }),
    ];
    return handle;
  };
  const open = (slot, disconnected = false) => {
    const id = ++runtimeSerial; identities[slot] = id;
    refusedAtOpen.set(id, new Set(refused));
    if (disconnected) offline.add(id);
    const app = createApp({ url, sessionStore: store(id), fetch: fetcher(id, slot) });
    const watched = new WeakSet();
    app.auth.onChange(() => {
      checkPublished(app, id, true);
      checkHandles();
      const client = app.client;
      if (!watched.has(client)) {
        watched.add(client);
        const changed = () => { checkPublished(app, id); checkHandles(); };
        client.onViewer(changed); client.onLink(changed); client.onAcquired(changed); client.onSession(changed);
      }
    });
    apps[slot] = app; return app.ready;
  };
  function check() {
    checkHandles();
    if (errors.length) assert.fail(errors[0]);
    const journal = (() => { try { return JSON.parse(values.get(key + ".revocations") ?? "null") ?? {}; } catch { return {}; } })();
    const held = new Set([record()?.token, ...(journal.tokens ?? []), ...(journal.all ?? []),
      ...(record()?.snapback4Retired ?? []), ...(record()?.snapback4LogoutAll ?? []), ...holds.map(h => h.token)]);
    for (const pending of holds) if (pending.storage) {
      // An unresolved store write remains owned by its live runtime, even if
      // the public auth action has already returned a cancellation refusal.
      const value = JSON.parse(pending.value);
      for (const token of [value.token, ...(value.tokens ?? []), ...(value.all ?? []), ...(value.snapback4Retired ?? []), ...(value.snapback4LogoutAll ?? [])]) held.add(token);
    }
    for (const app of apps) held.add(app?.client.session()?.token);
    for (const prior of privateRetries.values()) for (const token of live.keys()) {
      let ancestor = token;
      while (ancestor && ancestor !== prior) ancestor = parents.get(ancestor);
      if (ancestor === prior) held.add(token);
    }
    for (const [id, app] of apps.entries()) {
      checkPublished(app, identities[id]);
      if (!holds.length && !tasks.some(t => t.pending && t.id === id)) invariant("I4", app.auth.state !== "restoring", `app ${id} stuck restoring without an operation`);
      if (observed.get(identities[id]) === epoch() && app.auth.state === "signed-in") invariant("I4", app.auth.viewer === record()?.principal,
        `app ${id} exposes ${app.auth.viewer} after observing stored ${record()?.principal}`);
    }
    // A response/opening or retirement I/O still in flight owns its minted
    // sessions until completion. Held storage also blocks peer retirement on
    // the shared lock. At quiescence, every live token needs recorded custody.
    if (!holds.length && !tasks.some(t => t.pending)) for (const token of live.keys()) invariant("I3", held.has(token), `unowned live ${token}`);
    if (errors.length) assert.fail(errors[0]);
  }
  try {
    for (let id = 0; id < 3; id++) await open(id);
    for (const command of commands) {
      if (holds.some(held => held.storage && held.runtime !== identities[command.app])) count("interleaving.storage.peer");
      active = command; fault = command.fault; hits = 0; count(`op.${command.op}`);
      const { app: id, op } = command, app = apps[id];
      const before = { client: app?.client, token: app?.client.session()?.token, bytes: values.get(key), epoch: epoch(), concurrent: holds.length > 0 || tasks.some(t => t.pending) };
      let promise;
      if (op === "capture") capture(app, id);
      else if (["handleQuery", "handleMutate", "handleRefresh", "observeHandle", "readObservation"].includes(op)) {
        const candidates = handles.filter(h => h.slot === id);
        const h = (command.account ? candidates.at(-1) : candidates[0]) ?? capture(app, id);
        if (op === "observeHandle") {
          const observed = h.client.observe({ kind: "query", name: "viewer" }, {});
          observations.push({ handle: h, observed }); count("observation.created");
          observed.subscribe(() => { count("observation.notification"); checkHandles(); });
        } else if (op === "readObservation") checkHandles();
        else {
          const hidden = h.hidden;
          if (hidden) count(`handle.hidden.${op}`);
          if (op === "handleQuery") promise = h.client.query({ kind: "query", name: "viewer" }, { hiddenHandle: hidden }).then(result => {
            invariant("I8", !h.hidden || !("data" in result), "hidden handle returned query data"); return result;
          });
          if (op === "handleMutate") promise = h.client.mutate({ kind: "mutation", name: "write" }, { hiddenHandle: hidden }).then(result => {
            invariant("I8", !h.hidden || result.state === "failed", "hidden handle admitted a write"); return result;
          });
          if (op === "handleRefresh") promise = h.client.refreshSession().then(result => {
            invariant("I8", !h.hidden || !result.ok, "hidden handle returned a refresh credential"); return result;
          });
        }
      }
      else if (op === "refreshFault") {
        rotationFaults.add(identities[id]); promise = app.client.refreshSession();
      }
      else if (op === "release") { const held = holds.shift(); held?.resolve(); }
      else if (op === "holdStore") holdStore = true;
      else if (op === "closeClient") {
        if (app.auth.state === "signed-in") promise = app.client.close();
      }
      else if (op === "revoke" || op === "revokeCurrent") {
        const token = op === "revokeCurrent" ? app.client.session()?.token : record()?.token; if (token) { live.delete(token); count("server.revoke"); }
        promise = op === "revokeCurrent" || command.account ? app?.client.refreshSession() : app?.client.query({ kind: "query", name: "viewer" }, {});
      }
      else if (op === "reopen" || op === "reopenOffline") {
        if (!tasks.some(t => t.pending && t.id === id)) promise = app.close().then(() => {
          // Close may commit an owned, previously unpersisted rotation. The
          // following open is a separate operation with that durable baseline.
          before.bytes = values.get(key); before.epoch = epoch();
          return open(id, op === "reopenOffline");
        });
      } else if (op === "close") promise = app?.close();
      else if (op === "refresh") promise = app?.client.refreshSession();
      else if (op === "query") promise = app?.client.query({ kind: "query", name: "viewer" }, {});
      else if (op === "guest" || op === "logout" || op === "logoutEverywhere") promise = app?.auth[op]();
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
    fault = null; active = undefined; holdStore = false; offline.clear(); rotationFaults.clear();
    while (holds.length) holds.shift().resolve();
    await settle(); await Promise.all(tasks.map(t => t.promise));
    // Fair recovery: storage/network work again and all responses arrive. Each
    // runtime gets a successful logout retry, then restart drains durable work.
    for (const app of apps) { await app.auth.logout(); await settle(); }
    for (const app of apps) await app.close();
    await open(0); await apps[0].auth.logout(); await settle(); check();
    invariant("I3", live.size === 0, `live after recovery: ${[...live.keys()]}`);
    const journal = values.get(key + ".revocations");
    const global = new Set([...(journal ? JSON.parse(journal).all ?? [] : []), ...(record()?.snapback4LogoutAll ?? [])]);
    invariant("retirement", [...global].every(token => !acknowledgedGlobal.has(token)), "acknowledged global entries remain");
    invariant("retirement", !journal || JSON.parse(journal).tokens.every(token => global.has(token)), "acknowledged journal entries remain");
    invariant("retirement", !(record()?.snapback4Retired ?? []).some(token => !global.has(token)), "acknowledged tombstone entries remain");
    check();
  } finally {
    fault = null; active = undefined; holdStore = false; offline.clear(); rotationFaults.clear();
    while (holds.length) holds.shift().resolve();
    await settle();
    for (const entry of observations) entry.observed.close();
    for (const handle of handles) for (const stop of handle.stops) stop();
    for (const app of apps) await app?.close();
  }
}

// Deletion-minimal counterexample, replayed with the same deterministic wire
// and fault indices. Keep the invariant identity while removing commands.
export async function minimize(commands, failure) {
  const identity = failure.message.match(/(?:I[1-8]|retirement):/)?.[0] ?? failure.message;
  let minimal = commands;
  for (let i = 0; i < minimal.length;) {
    const candidate = minimal.filter((_, index) => index !== i);
    try { await execute(candidate); i++; }
    catch (error) { if (error.message.includes(identity)) { minimal = candidate; i = 0; } else i++; }
  }
  return minimal;
}
