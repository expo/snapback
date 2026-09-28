// Black-box state machine: real createApp/Client, a deterministic wire server,
// and a single-key-atomic store. No app implementation helpers are imported.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { setImmediate as tick } from "node:timers/promises";
import { promiseHooks } from "node:v8";
import { createApp } from "../../dist/app.js";
import { sessionKey } from "../../dist/auth.js";
import { modelBackend, modelDevice, modelPage, modelClock, modelReady } from "./app-model-device.mjs";

const sessionOperations = ["signup", "login", "guest", "refresh", "logout", "close", "reopen", "release", "query", "logoutEverywhere", "revoke", "reopenOffline", "holdStore", "closeClient", "capture", "handleQuery", "handleMutate", "handleRefresh", "observeHandle", "readObservation", "refreshFault", "revokeCurrent", "sibling", "retireOffline", "retireOnline"];
export const operations = [...sessionOperations, "receiptOffline", "receiptOnline", "handleWrite"];
export function generate(seed, length = 24) {
  let x = seed >>> 0;
  const choose = n => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  const receipts = seed % 4 === 0 ? [
    { op: "receiptOffline", app: 1 },
    { op: "handleMutate", app: 1, refuse: seed % 8 === 0, hold: seed % 12 === 0 },
    { op: "release", app: 1 }, { op: "handleWrite", app: 1 },
    { op: "receiptOnline", app: 1 }, { op: "handleWrite", app: 1 },
  ] : [];
  return [{ op: "guest", app: 0 }, { op: "reopen", app: 1 }, ...receipts, ...Array.from({ length }, () => ({
    op: sessionOperations[choose(sessionOperations.length)], app: choose(3), account: choose(2),
    hold: choose(5) === 0, fault: choose(3) === 0 ? { kind: ["get", "set", "delete"][choose(3)], at: 1 + choose(12) } : null,
    holdDispatch: choose(7) === 0,
  })).flatMap(command => command.op === "handleMutate"
    ? [command, { op: "handleWrite", app: command.app, account: command.account }] : [command])];
}
let sequenceSerial = 0;
let running = Promise.resolve();
export function execute(...args) {
  // A node:test timeout rejects the test, not its in-flight async body. Wait
  // for that sequence's real work before another sequence owns global timers.
  // Otherwise a late online close can clear a timer from a later local clock.
  const result = running.then(() => run(...args));
  running = result.catch(() => {});
  return result;
}
async function run(commands, coverage = {}, tier = "online", audit = {}) {
  if (tier === "local") await modelReady();
  const devices = tier === "local" ? Array.from({ length: 3 }, () => {
    const device = modelDevice();
    return { ...device, async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, ...rest) {
        if (receiptOffline && request.op === "keep_write") { count("fault.receiptSave"); throw Error("device receipt storage unavailable"); }
        return core.call(request, ...rest);
      } };
    } };
  }) : [];
  const clock = tier === "local" ? modelClock() : undefined;
  // Separate simulated backends must not share the package's per-URL lock
  // with background retirement from an earlier, already-checked sequence.
  const url = `https://session-model-${++sequenceSerial}.invalid`, key = sessionKey(url), values = new Map();
  const acknowledgedGlobal = new Set();
  const external = new Set(), globalReceipts = [];
  const attempts = [], globalOperations = [], tokenEpochs = new Map(), runtimeEpochs = new Map(), publishedClients = new Map(), retirementOffline = new Set();
  const declarations = new Map(); let operationSerial = 0;
  const live = new Map(), minted = new Map(), parents = new Map(), accounts = new Set(), holds = [], tasks = [], apps = [];
  const errors = [], observed = new Map(), identities = [], publishedTokens = new Map(), privateRetries = new Map(), refusedAtOpen = new Map(), refused = new Set(), offline = new Set();
  const handles = [], observations = [], rotationFaults = new Set();
  const writeReceipts = new Map(), deliveredWrites = new Set(); let writeSerial = 0;
  const results = new WeakMap(), closings = new WeakMap(), closedDeliveries = new Map();
  // A result fulfilled before hiding is already returned, even when its user's
  // .then callback runs after hiding. Audit the actual settlement boundary.
  const stopSettlements = promiseHooks.onSettled(promise => {
    const runtime = closings.get(promise);
    if (runtime !== undefined) closedDeliveries.set(runtime, new Set(deliveredWrites));
    const result = results.get(promise);
    if (result) { result.hidden = result.handle.hidden || result.handle.client.viewer() === null; result.delivered = new Set(deliveredWrites); count("handle.resultSettled"); }
  });
  const completed = (handle, promise, check) => {
    const result = { handle, hidden: handle.hidden };
    results.set(promise, result);
    return promise.then(value => { check(value, result.hidden, result.delivered ?? new Set(deliveredWrites)); return value; });
  };
  let holdStore = false, receiptOffline = false;
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
  const custody = () => {
    const journal = JSON.parse(values.get(key + ".revocations") ?? "null"), saved = record();
    return new Set([...(journal?.tokens ?? []), ...(journal?.all ?? []), ...(saved?.snapback4Retired ?? []), ...(saved?.snapback4LogoutAll ?? [])]);
  };
  function checkRetirement(before) {
    const after = custody();
    for (const token of before) if (!after.has(token)) {
      count("retirement.removed");
      invariant("I10", !live.has(token) && attempts.some(attempt => attempt.acknowledged && attempt.covered.has(token)),
        `retired ${token} without an acknowledgement covering that credential`);
    }
  }
  const declarationKey = fence => JSON.stringify([fence.principal, fence.epoch]);
  function inject(kind, k) {
    count(`storage.${kind}.${k === key ? "session" : k.endsWith(".epoch") ? "epoch" : k.endsWith(".revocations") ? "retirement" : "writes"}`);
    if (fault?.kind === kind && ++hits === fault.at) { count(`fault.${kind}`); count(`fault.${kind}.${hits}`); throw Error(`injected ${kind} #${hits}`); }
  }
  const store = id => ({
    get(k) {
      inject("get", k);
      const bytes = values.get(k) ?? null, readEpoch = epoch();
      // Delivery, not entry into the backing adapter, is the observation
      // boundary. Let the await continuation receive the bytes before marking
      // them observed; another ready callback can run while delivery is pending.
      return Promise.resolve({ then(resolve) {
        resolve(bytes);
        if (k === key) queueMicrotask(() => observed.set(id, readEpoch));
      } });
    },
    async set(k, value) {
      if (holdStore) { holdStore = false; count("held.storage.set"); await new Promise(resolve => holds.push({ resolve, storage: true, value, runtime: id })); }
      inject("set", k);
      if (receiptOffline && k.endsWith(".writes") && JSON.parse(value).receipts.length) {
        count("fault.receiptSave"); throw Error("receipt saves remain unavailable");
      }
      if (k === key && rotationFaults.has(id) && parents.has(JSON.parse(value).token)) {
        rotationFaults.delete(id); count("fault.rotationSave"); throw Error("one rotation save failed");
      }
      const before = record(), priorEpoch = BigInt(epoch()), beforeCustody = custody();
      values.set(k, value);
      if (k === key || k === key + ".revocations") checkRetirement(beforeCustody);
      if (k === key || k === key + ".epoch") {
        const after = record(), nextEpoch = BigInt(epoch());
        if (after?.token) tokenEpochs.set(after.token, epoch());
        for (const fence of after?.snapback4GlobalFences ?? []) if (!declarations.has(declarationKey(fence))) {
          const operation = globalOperations.findLast(value => value.runtime === id && value.pending);
          if (operation) {
            declarations.set(declarationKey(fence), operation);
            if (before?.token && operation.epoch !== undefined) invariant("I11", priorEpoch <= BigInt(operation.epoch),
              `global operation ${operation.id} in epoch ${operation.epoch} fenced account epoch ${priorEpoch}`);
          }
        }
        let ancestor = after?.token;
        while (ancestor && ancestor !== before?.token) ancestor = parents.get(ancestor);
        const rotation = Boolean(before?.token && ancestor === before.token);
        const replacement = Boolean(before?.token && after?.token && before.token !== after.token && !rotation);
        if (nextEpoch !== priorEpoch) invariant("I5", nextEpoch === priorEpoch + 1n && (replacement || after?.snapback4Logout !== undefined), "epoch changed outside an atomic replacement/logout commit");
        if (replacement) invariant("I5", nextEpoch === priorEpoch + 1n, "replacement reused the prior epoch");
      }
    },
    async delete(k) { inject("delete", k); const before = custody(); values.delete(k); checkRetirement(before); },
  });
  function issue(principal) {
    const session = { principal, token: `token-${++serial}`, kind: "user", expiresAt: Date.now() + 7 * 86400000 };
    live.set(session.token, principal); minted.set(session.token, session); return session;
  }
  const refusal = token => {
    for (let value = token; value; value = parents.get(value)) refused.add(value);
  };
  const fetcher = (id, slot) => async (input, init) => {
    const path = new URL(input).pathname, token = new Headers(init?.headers).get("authorization")?.slice(7);
    count(`wire.${path}`);
    const denied = token => {
      // A local read issued during its own rotation can see the consumed
      // predecessor refused. The client defers that read until rotation and
      // retries it; this is not yet a delivered session refusal. A refusal of
      // the successor (including after a failed save) still excludes its chain.
      const adopting = tier === "local" && holds.some(h => h.id === slot && h.path === "/auth/refresh" && parents.get(h.token) === token);
      if (adopting && path !== "/auth/refresh") count("wire.obsoleteAuth");
      else refusal(token);
      return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "refused" } }, { status: 401 });
    };
    const requestEpoch = epoch(), runtime = id;
    if (active?.holdDispatch && active.app === slot && ["/auth/signup", "/auth/login", "/auth/guest"].includes(path)) {
      count(`held.dispatch${path}`);
      await new Promise(resolve => holds.push({ id: slot, path, phase: "dispatch", resolve }));
    }
    if (offline.has(id)) { count("wire.offline"); throw Error("model is offline"); }
    if (path.startsWith("/auth/logout") && retirementOffline.has(id)) { count("wire.retirementOffline"); throw Error("retirement network is offline"); }
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
      const principal = minted.get(token)?.principal; let revoked = 0;
      const journal = JSON.parse(values.get(key + ".revocations") ?? "null");
      const fence = [...(journal?.fences ?? []), ...(record()?.snapback4GlobalFences ?? [])].find(value => value.tokens.includes(token));
      const operation = fence && declarations.get(declarationKey(fence));
      const attempt = { id: attempts.length + 1, operation: operation?.id, epoch: operation?.epoch,
        principal, covered: new Set([...minted].filter(([, value]) => value.principal === principal).map(([value]) => value)), acknowledged: false };
      attempts.push(attempt); count("global.attempt");
      if (operation?.epoch !== undefined && tokenEpochs.has(token)) invariant("I11", BigInt(tokenEpochs.get(token)) <= BigInt(operation.epoch),
        `attempt ${attempt.id} selected ${token} from epoch ${tokenEpochs.get(token)} for operation ${operation.id} in epoch ${operation.epoch}`);
      if (!live.has(token)) { count("global.attemptRefused"); return denied(token); }
      const covered = new Set([...live].filter(([, owner]) => owner === principal).map(([value]) => value));
      const completedFence = [...(journal?.fences ?? []), ...(record()?.snapback4GlobalFences ?? [])]
        .some(value => value.complete && value.principal === principal && operation?.epoch !== undefined && BigInt(value.epoch) > BigInt(operation.epoch));
      if (completedFence) {
        // I9 is not satisfied by killing a later login that the caller no
        // longer owns after its global logout was acknowledged. A still-pending
        // global attempt covers all sessions at its server linearization point.
        for (const value of covered) if (tokenEpochs.has(value)) invariant("I9", BigInt(tokenEpochs.get(value)) <= BigInt(operation.epoch),
          `stale global operation ${operation.id} killed later login ${value}`);
      }
      for (const [value, owner] of live) if (owner === principal) { live.delete(value); revoked++; }
      // The server linearization point covers every existing session, including
      // externally owned siblings and rotations whose response is still held.
      globalReceipts.push({ principal, covered }); count("global.acknowledged");
      if (parents.has(token)) count("global.rotatedBearer");
      if ([...covered].some(value => external.has(value))) count("global.externalSiblingRevoked");
      if (active?.hold && active.app === slot) { count(`held.${path}`); await new Promise(resolve => holds.push({ id: slot, token, attempt: attempt.id, resolve })); }
      attempt.acknowledged = true;
      if ([...live].some(([value, owner]) => owner === principal && !attempt.covered.has(value))) count("global.ackWithLaterToken");
      acknowledgedGlobal.add(token);
      return Response.json({ ok: true, revoked });
    } else if (path === "/auth/logout") {
      invariant("I1", record()?.token !== token, `revoking stored ${token}`);
      const attempt = { id: attempts.length + 1, covered: new Set([token]), acknowledged: false };
      attempts.push(attempt);
      live.delete(token);
      if (active?.hold && active.app === slot) {
        count(`held.${path}`);
        await new Promise(resolve => holds.push({ id: slot, token, resolve }));
      }
      attempt.acknowledged = true;
      return Response.json({ ok: true });
    } else if (path === "/changes") {
      // Real observations long-poll. Keep the mock idle until its lifetime is
      // cancelled; this avoids inventing a fast polling loop in the generator.
      return new Promise(resolve => {
        const stop = () => resolve(Response.json({ seq: 0, tables: [] }));
        if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener("abort", stop, { once: true });
      });
    } else if (path === "/schema") return live.has(token) ? Response.json(modelBackend) : denied(token);
    else if (path === "/sync") return live.has(token) ? Response.json(modelPage(writeReceipts.size, JSON.parse(init.body))) : denied(token);
    else if (path === "/probe") return live.has(token) ? Response.json({ ok: true, seq: writeReceipts.size, store_id: "session-model-store" }) : denied(token);
    else if (path.startsWith("/m/")) {
      if (!live.has(token)) return denied(token);
      invariant("I8", !JSON.parse(init.body).args?.hiddenHandle, "hidden handle dispatched a write");
      count("wire.handleWrite");
      const id = JSON.parse(init.body).id;
      const receipt = writeReceipts.get(id) ?? (JSON.parse(init.body).args?.refuse
        ? { state: "failed", id, why: { code: "E_MODEL_REFUSED", family: "input", message: "authoritative mutation refusal", site: "write", rewrite: "submit an allowed write", retryable: false } }
        : { state: "sent", id, seq: writeReceipts.size + 1 });
      writeReceipts.set(id, receipt); count(`write.${receipt.state}`);
      if (active?.hold && active.app === slot) {
        count(`held.${path}`); await new Promise(resolve => holds.push({ id: slot, token, resolve }));
      }
      const response = Response.json(receipt), json = response.json.bind(response);
      response.json = async () => { const value = await json(); deliveredWrites.add(`${runtime}/${id}`); return value; };
      return response;
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
    tokenEpochs.set(session.token, parents.has(session.token) ? tokenEpochs.get(token) ?? requestEpoch : requestEpoch);
    const owner = active;
    if (owner?.hold && owner.app === slot) {
      count(`held.${path}`);
      await new Promise(resolve => holds.push({ id: slot, token: session.token, path, resolve }));
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
        if (result.ok && before.principal) {
          count("global.publicAcknowledgement");
          for (const token of live.keys()) {
            let original = token; while (parents.has(original)) original = parents.get(original);
            invariant("I9", !before.globalCovered.has(original) && !before.globalCovered.has(token), `acknowledged logoutEverywhere left ${token} live for ${before.principal}`);
          }
        }
        if (before.expectOk !== undefined) invariant("I9", result.ok === before.expectOk, `global result was ${result.ok}, expected ${before.expectOk}`);
      }
      if (op === "close" || op === "closeClient" || op === "reopen" || op === "reopenOffline") privateRetries.delete(id);
    }, error => { task.result = { ok: false, error: String(error) }; }).finally(() => { task.pending = false; if (before.globalOperation) before.globalOperation.pending = false; });
    return task;
  };
  async function settle() {
    for (let round = 0; round < (clock ? 4 : 1); round++) {
      for (let n = 0; n < 4; n++) await tick();
      if (!clock || holds.length) break;
      clock.tick(); for (let n = 0; n < 4; n++) await tick();
      // Local refusal cleanup can start a close after the first timer tick.
      // Let that bounded private cleanup finish before declaring quiescence.
      if (!apps.some(app => app.auth.state === "restoring") && !tasks.some(task => task.pending)) break;
    }
  }
  async function finish(promise) {
    if (!clock) return promise;
    let done = false;
    const completion = Promise.resolve(promise).finally(() => { done = true; });
    void completion.catch(() => {});
    for (let n = 0; n < 100 && !done; n++) await settle();
    assert.ok(done, "model fair recovery did not finish within 100 clock steps");
    return completion;
  }
  function checkPublished(app, id, publication = false) {
    const { state, viewer } = app.auth, client = app.client;
    if (state === "signed-out") invariant("I6", viewer === null && client.viewer() === null && client.session() === null, `signed-out runtime ${id} exposes a live client`);
    if (state === "signed-in") {
      if (publication && publishedClients.get(id) !== client) { runtimeEpochs.set(id, epoch()); publishedClients.set(id, client); }
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
  const outcomeKey = write => write?.state === "sent" ? JSON.stringify([write.id, write.state, write.seq])
    : write?.state === "failed" ? JSON.stringify([write.id, write.state, write.why.code, write.why.family]) : undefined;
  function checkOutcome(handle, id, write, source) {
    const prior = handle.outcomes.get(id), authoritative = writeReceipts.get(id);
    const known = outcomeKey(write);
    if (prior) invariant("I13", known === prior, `${source} disagreed for known ${id}: ${JSON.stringify(write)}`);
    if (known && authoritative) {
      invariant("I13", known === outcomeKey(authoritative), `${source} contradicted the server's outcome for ${id}`);
      handle.outcomes.set(id, known); count(`consistent.${source}.${write.state}`);
      if (source === "mutate") invariant("I13", handle.notified.get(id) === known, `mutate returned ${id} without its onWrite notification`);
      if (source === "onWrite") handle.notified.set(id, known);
    }
  }
  const capture = (app, slot) => {
    const handle = { app, slot, runtime: identities[slot], client: app.client, principal: app.client.viewer(), hidden: false,
      writes: [], outcomes: new Map(), notified: new Map() };
    handles.push(handle); count("handle.captured");
    handle.stops = [
      handle.client.onWrite(write => checkOutcome(handle, write.id, write, "onWrite")),
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
    count(`open.${tier}`);
    const app = createApp({ url, sessionStore: store(id), fetch: fetcher(id, slot), ...(devices[slot] ? { device: devices[slot] } : {}) });
    const close = app.close;
    app.close = () => { const promise = close(); closings.set(promise, id); return promise; };
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
      ...(record()?.snapback4Retired ?? []), ...(record()?.snapback4LogoutAll ?? []), ...holds.map(h => h.token), ...external]);
    for (const receipt of globalReceipts) for (const token of live.keys()) {
      let predecessor = token;
      while (predecessor && !receipt.covered.has(predecessor)) predecessor = parents.get(predecessor);
      invariant("I9", !predecessor, `globally revoked ${receipt.principal} retained ${token}`);
    }
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
      const principal = app?.client.viewer();
      const before = { client: app?.client, token: app?.client.session()?.token, principal, expectOk: command.expectOk,
        globalCovered: new Set([...minted].filter(([, value]) => value.principal === principal).map(([token]) => token)),
        bytes: values.get(key), epoch: epoch(), concurrent: holds.length > 0 || tasks.some(t => t.pending) };
      if (op === "logoutEverywhere" && principal) {
        if (record()?.principal === principal && record().token !== before.token && runtimeEpochs.get(identities[id]) === epoch()) count("global.peerPersistedRotation");
        if (record()?.principal === principal && runtimeEpochs.get(identities[id]) !== epoch()) count("global.newerAccountEpoch");
        if (holds.some(value => value.path === "/auth/refresh" && value.id !== id && minted.get(value.token)?.principal === principal)) count("global.peerHeldRotation");
      }
      if (op === "logoutEverywhere") {
        before.globalOperation = { id: ++operationSerial, runtime: identities[id], epoch: runtimeEpochs.get(identities[id]), principal, pending: true };
        globalOperations.push(before.globalOperation);
      }
      let promise;
      if (op === "sibling") {
        const principal = record()?.principal;
        if (principal) { external.add(issue(principal).token); count("server.externalSibling"); }
      }
      else if (op === "capture") capture(app, id);
      else if (["handleQuery", "handleMutate", "handleWrite", "handleRefresh", "observeHandle", "readObservation"].includes(op)) {
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
          if (op === "handleQuery") promise = completed(h, h.client.query({ kind: "query", name: "viewer" }, { hiddenHandle: hidden }), (result, hidden) => {
            invariant("I8", !hidden || !("data" in result), "hidden handle returned query data");
          });
          if (op === "handleWrite") {
            const id = h.writes.at(command.account ? -1 : 0) ?? [...h.outcomes.keys()].at(-1);
            if (id) promise = completed(h, h.client.write(id), (result, ended) => {
              if (!ended) {
                checkOutcome(h, id, result, "write");
                if (receiptOffline && h.outcomes.has(id)) count("consistent.writeDuringReceiptFailure");
              }
            });
          }
          if (op === "handleMutate") {
            const id = String(++writeSerial).padStart(26, "0");
            h.writes.push(id);
            promise = completed(h, h.client.mutate({ kind: "mutation", name: "write" }, { hiddenHandle: hidden, refuse: command.refuse ?? command.account === 1 }, { id }), (result, ended, delivered) => {
              invariant("I8", !hidden || !writeReceipts.has(id), "already-hidden handle dispatched a write");
              if (writeReceipts.has(id)) {
                count("write.outcome"); count(`write.outcome.${writeReceipts.get(id).state}`);
                if (ended) { count("write.outcomeAfterFence"); count(`write.outcomeAfterFence.${writeReceipts.get(id).state}`); }
                audit.mutateOutcome?.(result, ended);
                const known = (closedDeliveries.get(h.runtime) ?? delivered).has(`${h.runtime}/${id}`);
                if (result.state === "pending") {
                  invariant("I12", ended && !known, `known/live ${id} outcome replaced by pending (ended=${ended}, known=${known})`);
                  invariant("I12", result.id === id, `unknown ${id} lost its retry id`);
                  count("write.unknownAtClose");
                } else {
                  invariant("I12", known && isDeepStrictEqual(JSON.parse(JSON.stringify(result)), writeReceipts.get(id)), `known ${id} outcome replaced by ${JSON.stringify(result)}`);
                  count("write.knownAtDelivery");
                  if (!ended) checkOutcome(h, id, result, "mutate");
                }
              }
            });
          }
          if (op === "handleRefresh") promise = completed(h, h.client.refreshSession(), result => {
            invariant("I8", !hidden || !result.ok, "already-hidden handle admitted a refresh");
          });
        }
      }
      else if (op === "refreshFault") {
        rotationFaults.add(identities[id]); promise = app.client.refreshSession();
      }
      else if (op === "release") { const held = holds.shift(); held?.resolve(); }
      else if (op === "receiptOffline") receiptOffline = true;
      else if (op === "receiptOnline") receiptOffline = false;
      else if (op === "retireOffline") retirementOffline.add(identities[id]);
      else if (op === "retireOnline") retirementOffline.delete(identities[id]);
      else if (op === "holdStore") holdStore = true;
      else if (op === "closeClient") {
        if (app.auth.state === "signed-in") { promise = app.client.close(); closings.set(promise, identities[id]); }
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
      if (command.expectRevoked) invariant("I9", [...external].every(token => !live.has(token)), "late rotation did not globally revoke external siblings");
    }
    fault = null; active = undefined; holdStore = false; receiptOffline = false; offline.clear(); rotationFaults.clear(); retirementOffline.clear();
    while (holds.length) holds.shift().resolve();
    await settle(); await finish(Promise.all(tasks.map(t => t.promise)));
    // Fair recovery: storage/network work again and all responses arrive. Each
    // runtime gets a successful logout retry, then restart drains durable work.
    for (const app of apps) { await finish(app.auth.logout()); await settle(); }
    for (const app of apps) await finish(app.close());
    await open(0); await apps[0].auth.logout(); await settle(); check();
    invariant("I3", [...live.keys()].every(token => external.has(token)), `unowned live after recovery: ${[...live.keys()].filter(token => !external.has(token))}`);
    const journal = values.get(key + ".revocations");
    const global = new Set([...(journal ? JSON.parse(journal).all ?? [] : []), ...(record()?.snapback4LogoutAll ?? [])]);
    invariant("retirement", [...global].every(token => !acknowledgedGlobal.has(token)), "acknowledged global entries remain");
    invariant("retirement", !journal || JSON.parse(journal).tokens.every(token => global.has(token)), "acknowledged journal entries remain");
    invariant("retirement", !(record()?.snapback4Retired ?? []).some(token => !global.has(token)), "acknowledged tombstone entries remain");
    check();
  } finally {
    fault = null; active = undefined; holdStore = false; receiptOffline = false; offline.clear(); rotationFaults.clear(); retirementOffline.clear();
    while (holds.length) holds.shift().resolve();
    await settle();
    for (const entry of observations) entry.observed.close();
    for (const handle of handles) for (const stop of handle.stops) stop();
    try { for (const app of apps) await finish(app?.close()); }
    finally { stopSettlements(); clock?.close(); }
  }
}

// Deletion-minimal counterexample, replayed with the same deterministic wire
// and fault indices. Keep the invariant identity while removing commands.
export async function minimize(commands, failure, tier = "online") {
  const identity = failure.message.match(/(?:I(?:1[0123]|[1-9])|retirement):/)?.[0] ?? failure.message;
  let minimal = commands;
  for (let i = 0; i < minimal.length;) {
    const candidate = minimal.filter((_, index) => index !== i);
    try { await execute(candidate, {}, tier); i++; }
    catch (error) { if (error.message.includes(identity)) { minimal = candidate; i = 0; } else i++; }
  }
  return minimal;
}
