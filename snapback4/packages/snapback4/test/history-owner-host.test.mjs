// Exercise the actual host/journal sources with a device boundary double. This
// does not build or load wasm: Rust device behavior has its own crate tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const denied = { denied: { code: "SNAPBACK_HISTORY_OWNER", family: "structural", message: "preserve the original store" } };
const healthyState = { store_id: "store", backend_required: false, send_revision: 1 };

function modulesFor(WebDevice, globals) {
  const context = vm.createContext({ console, TextEncoder, window: {}, URL, AbortController, Response, crypto: globalThis.crypto, setTimeout, clearTimeout, ...globals });
  const modules = new Map();
  function load(file, extra = "") {
    const url = new URL(`../src/${file}`, import.meta.url);
    const source = readFileSync(url, "utf8").replaceAll("import.meta.url", JSON.stringify(url.href));
    const compiled = ts.transpileModule(source + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    const require = name => {
      if (name === "./wasm/snapback4_device.js") return { WebDevice };
      if (modules.has(name)) return modules.get(name);
      if (name.startsWith("./") && name.endsWith(".ts")) {
        const exports = load(name.slice(2)); modules.set(name, exports); return exports;
      }
      throw new Error(`unexpected import ${name}`);
    };
    vm.runInContext(`(function(exports, require) { ${compiled}\n})`, context)(exports, require);
    return exports;
  }
  const journal = load("web-journal.ts"); modules.set("./web-journal.ts", journal);
  const web = load("web.ts", "\nready = Promise.resolve();\nexport { adoptOrphans };\n");
  return { journal, web, get local() { return load("local.ts"); } };
}

function harness(phase, owner = "dev:bob") {
  const name = "history-host", orphan = `${name}:tab-foreign`, healthy = `${name}:tab-healthy`;
  const journalKey = `snapback4-admission:${encodeURIComponent(orphan)}:store:write`;
  const entry = { id: "write", seq: 1, op: "send", args: {}, new_ids: [], viewer: "dev:bob", now: 1 };
  const storage = new Map([[journalKey, JSON.stringify({ key: journalKey, storeId: "store", entry })]]);
  const localStorage = {
    get length() { return storage.size; }, key: n => [...storage.keys()][n],
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k),
  };
  const sources = new Map([
    [orphan, [
      { s: "m", k: "device:store_id", v: "store" },
      { s: "m", k: "device:backend", v: "{}" },
      { s: "m", k: "device:history-owner", v: owner },
      { s: "r", k: "private", v: "only copy" },
      { s: "o", k: "private-write", v: JSON.stringify({ ...entry, id: "private-write" }) },
    ]],
    [healthy, [{ s: "m", k: "device:store_id", v: "store" }, { s: "m", k: "device:history-owner", v: "dev:bob" }, { s: "o", k: "healthy-write", v: JSON.stringify({ ...entry, id: "healthy-write" }) }]],
  ]);
  const before = JSON.stringify(sources.get(orphan)), journalBefore = storage.get(journalKey);
  const saves = [], removed = [], released = [], imported = [], calls = [];
  let freed = 0, constructed = 0;
  class WebDevice {
    constructor() {
      constructed++;
      if (phase === "constructor") throw denied;
      if (phase === "unstructured-error") throw new Error("SNAPBACK_HISTORY_OWNER: transport broke");
    }
    call(text) {
      const request = JSON.parse(text); calls.push(request.op);
      if (request.op === "sync_state") {
        const n = calls.filter(op => op === "sync_state").length;
        if (phase === "sync-state" || (phase === "recover-state" && n === 2)) return JSON.stringify(denied);
        if (phase === "restore-refusal") return JSON.stringify({ ok: { ...healthyState, restore_refusal: denied.denied } });
        return JSON.stringify({ ok: { ...healthyState, backend_required: phase === "adopt" } });
      }
      if (request.op === "adopt" || request.op === "admit") return JSON.stringify(denied);
      if (request.op === "queued") return JSON.stringify({ ok: [] });
      if (request.op === "next_submission") return JSON.stringify({ ok: 1 });
      throw new Error(`unexpected source call ${request.op}`);
    }
    drain() { return "[]"; }
    free() { freed++; }
  }
  const { journal, web } = modulesFor(WebDevice, { localStorage });
  const journalLoads = [];
  const loadJournal = journal.AdmissionJournal.prototype.load;
  journal.AdmissionJournal.prototype.load = function (saved) { journalLoads.push(saved); return loadJournal.call(this, saved); };
  const persist = {
    others: async () => [...sources.keys()],
    claim: async name => ({ name, async release() { released.push(name); } }),
    load: async name => sources.get(name),
    save: async (name, changes) => { saves.push(name); sources.set(name, [...sources.get(name), ...changes]); },
    remove: async name => { removed.push(name); sources.delete(name); },
  };
  const destination = { call(text) {
    const request = JSON.parse(text);
    if (request.op === "sync_state") return JSON.stringify(phase === "destination-denied" ? denied : { ok: { ...healthyState, ...(phase === "destination-restore" ? { restore_refusal: denied.denied } : {}) } });
    if (request.op === "backend") return JSON.stringify({ ok: {} });
    if (request.op === "queued") return JSON.stringify({ ok: [] });
    if (request.op === "next_submission") return JSON.stringify({ ok: 1 });
    if (request.op === "enqueue") { imported.push(request.entry.id); return JSON.stringify({ ok: null }); }
    throw new Error(`unexpected destination call ${request.op}`);
  } };
  return { journal, journalLoads, sources, orphan, healthy, before, storage, journalKey, journalBefore, saves, removed, released, imported, calls,
    get freed() { return freed; }, get constructed() { return constructed; },
    run: () => web.adoptOrphans(destination, name, name, "dev:bob", persist, async () => {}, () => {}, () => {}),
  };
}

for (const phase of ["constructor", "sync-state", "adopt", "recover-state", "recover-admit", "restore-refusal"]) {
  test(`H10: structural ${phase} refusal preserves the orphan and continues`, async () => {
    const f = harness(phase);
    assert.equal(await f.run(), false, "ownership refusal must not schedule another retry");
    assert.equal(JSON.stringify(f.sources.get(f.orphan)), f.before);
    assert.equal(f.storage.get(f.journalKey), f.journalBefore);
    assert.deepEqual(f.saves, []);
    assert.deepEqual(f.removed, [f.healthy]);
    assert.deepEqual(f.imported, ["healthy-write"]);
    assert.deepEqual(f.released, [f.orphan, f.healthy]);
    assert.equal(f.freed, phase === "constructor" ? 0 : 1);
    if (["constructor", "sync-state", "adopt", "restore-refusal"].includes(phase)) assert.ok(!f.calls.includes("admit"));
    if (phase === "sync-state") assert.equal(f.calls.filter(op => op === "sync_state").length, 1, "refuse before invoking recover");
    if (["constructor", "sync-state", "restore-refusal"].includes(phase)) assert.deepEqual(f.journalLoads, [], "source must refuse before journal load");
  });
}

test("H10: formatted error text is not an authorization code", async () => {
  const f = harness("unstructured-error");
  assert.equal(await f.run(), true, "a transport error remains retryable");
  assert.equal(JSON.stringify(f.sources.get(f.orphan)), f.before);
  assert.deepEqual(f.imported, ["healthy-write"]);
});

test("H10: a constructor reset cannot graft another principal's journal", async () => {
  const f = harness("recover-admit", "dev:alice");
  assert.equal(await f.run(), false);
  assert.equal(f.constructed, 0);
  assert.equal(JSON.stringify(f.sources.get(f.orphan)), f.before);
  assert.equal(f.storage.get(f.journalKey), f.journalBefore);
  assert.deepEqual(f.imported, ["healthy-write"]);
});

test("H10: ordinary authored refusals remain terminal; history-owner refusal does not", () => {
  const f = harness("constructor");
  assert.equal(f.journal.writeRefusal({ denied: { code: "E_AUTH", retryable: false } }), true);
  assert.equal(f.journal.writeRefusal(denied), false);
});


test("H10: foreign outbox without a journal is preserved too", async () => {
  const f = harness("recover-admit", "dev:alice");
  f.storage.clear();
  assert.equal(await f.run(), false);
  assert.equal(f.constructed, 0);
  assert.equal(JSON.stringify(f.sources.get(f.orphan)), f.before);
  assert.deepEqual(f.imported, ["healthy-write"]);
});


test("H10: the last persisted owner governs an ordered change stream", async () => {
  const f = harness("constructor");
  f.sources.get(f.orphan).push({ s: "m", k: "device:history-owner", v: "dev:alice" });
  const before = JSON.stringify(f.sources.get(f.orphan));
  assert.equal(await f.run(), false);
  assert.equal(f.constructed, 0);
  assert.equal(JSON.stringify(f.sources.get(f.orphan)), before);
  assert.deepEqual(f.imported, ["healthy-write"]);
});


test("H10: unknown-owner replica without a journal stays intact", async () => {
  const f = harness("recover-admit", null);
  f.storage.clear();
  assert.equal(await f.run(), false);
  assert.equal(f.constructed, 0);
  assert.equal(JSON.stringify(f.sources.get(f.orphan)), f.before);
  assert.deepEqual(f.imported, ["healthy-write"]);
});

for (const phase of ["destination-denied", "destination-restore"]) {
  test(`W2: ${phase} blocks all orphan side effects`, async () => {
    const f = harness(phase);
    await assert.rejects(f.run(), e => f.journal.historyOwnerRefusal(e));
    assert.equal(JSON.stringify(f.sources.get(f.orphan)), f.before);
    assert.equal(f.storage.get(f.journalKey), f.journalBefore);
    assert.deepEqual(f.saves, []);
    assert.deepEqual(f.removed, []);
    assert.deepEqual(f.imported, []);
    assert.deepEqual(f.released, []);
    assert.equal(f.constructed, 0);
  });
}

function restoreHarness(refusal, owner = "guest:old", projection) {
  const name = "primary";
  const viewer = "password:new";
  const key = `snapback4-admission:${name}:store:write`;
  const entry = { id: "write", seq: 1, op: "send", args: { private: "payload" }, new_ids: [], viewer: owner, now: 1 };
  const record = { key, storeId: "store", entry };
  const storage = new Map([[key, JSON.stringify(record)]]);
  const localStorage = {
    get length() { return storage.size; }, key: n => [...storage.keys()][n],
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k),
  };
  const saved = [
    { s: "m", k: "device:history-owner", v: owner },
    { s: "m", k: "device:store_id", v: "store" },
    { s: "o", k: "queued", v: JSON.stringify({ ...entry, id: "queued" }) },
    { s: "j", k: "already-transferred", v: JSON.stringify({ key, storeId: "store", recovered: true }) },
  ];
  const before = JSON.stringify(saved), journalBefore = storage.get(key);
  const effects = [], admitted = [], sent = [], calls = [], changes = [];
  let activeDevice;
  let freed = 0, released = 0;
  class WebDevice {
    queued = new Map();
    constructor(_backend, kept, requested) {
      activeDevice = this;
      assert.equal(requested, viewer);
      assert.equal(kept, JSON.stringify(saved.filter(c => c.s !== "j")));
      for (const c of JSON.parse(kept)) if (c.s === "o") {
        if (c.v === null) this.queued.delete(c.k);
        else this.queued.set(c.k, JSON.parse(c.v));
      }
      changes.push({ s: "m", k: "device:history-owner", v: viewer });
    }
    call(text) {
      const request = JSON.parse(text); calls.push(request.op);
      if (request.op === "sync_state") return JSON.stringify(refusal === "denied" ? denied : { ok: { ...healthyState, ...(refusal === "restore" ? { restore_refusal: denied.denied } : {}) } });
      if (request.op === "queued") return JSON.stringify({ ok: [...this.queued.values()].filter(e => projection ? projection.has(e.id) : e.viewer === viewer) });
      if (request.op === "next_submission") return JSON.stringify({ ok: 2 });
      if (request.op === "admit") { admitted.push(request.entry); return JSON.stringify({ ok: null }); }
      if (request.op === "dequeue") { this.queued.delete(request.id); changes.push({ s: "o", k: request.id, v: null }); return JSON.stringify({ ok: null }); }
      if (request.op === "begin_send") {
        // The old unqualified call fenced sync without rechecking the captured
        // write. Keep that behavior in the double so a missing ID leaks visibly.
        if (!request.ids) return JSON.stringify({ ok: null });
        return JSON.stringify(request.ids.every(id => projection ? projection.has(id) : this.queued.get(id)?.viewer === viewer) ? { ok: null } : denied);
      }
      if (request.op === "apply") return JSON.stringify({ ok: null });
      throw new Error(`unexpected primary call ${request.op}`);
    }
    drain() { effects.push("drain"); return JSON.stringify(changes.splice(0)); }
    free() { freed++; }
  }
  const page = new EventTarget(), doc = new EventTarget();
  const { journal, web } = modulesFor(WebDevice, { localStorage, window: page, document: doc });
  for (const method of ["load", "remember", "cleanup", "recover"]) {
    const original = journal.AdmissionJournal.prototype[method];
    journal.AdmissionJournal.prototype[method] = function (...args) { effects.push(method); return original.apply(this, args); };
  }
  const persist = {
    claim: async name => ({ name, async release() { released++; } }),
    load: async () => saved,
    save: async (_name, changes) => {
      effects.push("save");
      for (const c of changes) {
        for (let at = saved.length - 1; at >= 0; at--) if (saved[at].s === c.s && saved[at].k === c.k) saved.splice(at, 1);
        if (c.v !== null) saved.push(c);
      }
    },
  };
  return { saved, before, storage, key, journalBefore, effects, admitted, sent, calls, journal,
    get freed() { return freed; }, get released() { return released; },
    open: () => web.webDevice({ persist }).open(name, {}, viewer),
    suspend: (core, beforeSend = () => {}) => { core.onSuspend((entries, beginSend) => { beforeSend(); if (beginSend()) sent.push(...entries); }); page.dispatchEvent(new Event("pagehide")); },
    get device() { return activeDevice; },
  };
}

for (const refusal of ["denied", "restore"]) {
  test(`W1: primary ${refusal} refuses before journal load, mirror or persistence`, async () => {
    const f = restoreHarness(refusal);
    await assert.rejects(f.open(), /SNAPBACK_HISTORY_OWNER/);
    assert.deepEqual(f.effects, [], "no journal or commit side effect before refusal");
    assert.deepEqual(f.admitted, []);
    assert.equal(JSON.stringify(f.saved), f.before);
    assert.equal(f.storage.get(f.key), f.journalBefore);
    assert.equal(f.freed, 1);
    assert.equal(f.released, 1);
  });
}

test("W1: permitted principal reset never recovers or sends the old journal/outbox", async () => {
  const f = restoreHarness(null);
  const core = await f.open();
  try {
    f.suspend(core);
    await core.call({ op: "apply" }); // Later recovery must still ignore the old journal.
    assert.deepEqual(f.admitted, []);
    assert.deepEqual(f.sent, []);
    assert.equal(f.storage.get(f.key), f.journalBefore);
    assert.ok(!f.saved.some(c => c.s === "o" || c.s === "j"));
  } finally { await core.close(); }
});

test("W1: matching principal still recovers its untransferred journal", async () => {
  const f = restoreHarness(null, "password:new");
  f.saved.splice(f.saved.findIndex(c => c.s === "j"), 1);
  const core = await f.open();
  try { assert.equal(f.admitted.length, 1); assert.equal(f.admitted[0].viewer, "password:new"); }
  finally { await core.close(); }
});

for (const binding of ["absent", "deleted"]) {
  test(`X1: legacy ${binding} binding preserves the only committed offline write across upgrade`, async () => {
    const f = restoreHarness(null, "password:new");
    if (binding === "absent") f.saved.splice(f.saved.findIndex(c => c.k === "device:history-owner"), 1);
    else f.saved.push({ s: "m", k: "device:history-owner", v: null });
    f.saved.splice(f.saved.findIndex(c => c.s === "j"), 1);
    f.storage.clear(); // Successful admission already removed the synchronous copy.
    const original = f.saved.find(c => c.s === "o").v;
    for (let reopen = 0; reopen < 2; reopen++) {
      const core = await f.open();
      try {
        assert.equal(f.saved.find(c => c.s === "o")?.v, original, "upgrade deleted the only copy of a committed offline write");
        assert.equal((await core.call({ op: "queued" })).ok[0].id, "queued");
        f.suspend(core);
        assert.equal(f.sent.at(-1).id, "queued", "the persisted write remains eligible for transport");
        assert.equal(f.saved.find(c => c.k === "device:history-owner").v, "password:new");
        assert.equal(f.storage.size, 0);
        assert.deepEqual(f.admitted, [], "committed writes are not admitted a second time");
        assert.ok(!f.calls.includes("dequeue"));
      } finally { await core.close(); }
    }
  });
}

test("X1: legacy first binding fences foreign and unlabelled outbox entries", async () => {
  const f = restoreHarness(null, "password:new");
  f.saved.splice(f.saved.findIndex(c => c.k === "device:history-owner"), 1);
  f.saved.splice(f.saved.findIndex(c => c.s === "j"), 1);
  f.storage.clear();
  const own = JSON.parse(f.saved.find(c => c.s === "o").v);
  for (const [id, viewer] of [["foreign", "guest:old"], ["unlabelled", undefined]]) {
    f.saved.push({ s: "o", k: id, v: JSON.stringify({ ...own, id, viewer }) });
  }
  const core = await f.open();
  try {
    assert.deepEqual(Array.from((await core.call({ op: "queued" })).ok, e => e.id), ["queued"]);
    f.suspend(core);
    assert.deepEqual(f.sent.map(e => e.id), ["queued"]);
    assert.deepEqual(f.saved.filter(c => c.s === "o").map(c => c.k), ["queued"]);
  } finally { await core.close(); }
});

test("X1: a legacy owned write keeps its recovered transfer fence", async () => {
  const f = restoreHarness(null, "password:new");
  f.saved.splice(f.saved.findIndex(c => c.k === "device:history-owner"), 1);
  const transfer = f.saved.find(c => c.s === "j");
  transfer.k = "queued";
  transfer.v = JSON.stringify({ key: f.key, storeId: "previous-incarnation", recovered: true });
  f.storage.clear();
  const core = await f.open();
  try {
    assert.ok(f.saved.some(c => c.s === "o" && c.k === "queued"));
    assert.equal(f.saved.find(c => c.s === "j")?.v, transfer.v);
    await core.call({ op: "apply" });
    assert.ok(!f.saved.some(c => c.s === "o"), "a recovered intent cannot cross backend incarnations");
  } finally { await core.close(); }
});

test("X1: retired outbox tombstones need no device dequeue", async () => {
  const f = restoreHarness(null);
  f.saved.find(c => c.s === "o").v = null;
  const core = await f.open();
  try { assert.ok(!f.calls.includes("dequeue")); }
  finally { await core.close(); }
});

test("Y1: restore consumes the device projection even when saved viewer labels suggest otherwise", async () => {
  // Opaque device disposition: tests delegation, not a second host predicate.
  const f = restoreHarness(null, "guest:old", new Set(["queued"]));
  f.storage.clear();
  const original = f.saved.find(c => c.s === "o").v;
  const core = await f.open();
  try {
    assert.equal(f.saved.find(c => c.s === "o")?.v, original);
    f.suspend(core);
    assert.deepEqual(f.sent.map(e => e.id), ["queued"]);
  } finally { await core.close(); }
});

test("Y1: a matching saved owner cannot override an excluded device write", async () => {
  const f = restoreHarness(null, "password:new", new Set());
  f.storage.clear();
  const core = await f.open();
  try {
    f.suspend(core);
    assert.deepEqual(f.sent, []);
    assert.ok(!f.saved.some(c => c.s === "o"));
  } finally { await core.close(); }
});

for (const afterCapture of [false, true]) test(`Y1: pagehide rechecks device ownership ${afterCapture ? "after" : "before"} queue capture`, async () => {
  const projection = new Set(["queued"]);
  const f = restoreHarness(null, "password:new", projection);
  f.storage.clear();
  const core = await f.open();
  try {
    if (!afterCapture) projection.clear();
    f.suspend(core, () => projection.clear());
    assert.deepEqual(f.sent, [], "stale committed arguments must never reach transport");
  } finally { await core.close(); }
});

for (const superseded of [false, true]) test(`Y1: shared sender ${superseded ? "fences a superseded" : "sends the matching"} device entry with current credentials`, { timeout: 3000 }, async () => {
  const { local } = modulesFor(class {}, {});
  const backend = { generation: 1, schema: { tables: {} }, programs: [{ name: "send", kind: "Mutation", args: {}, body: [] }] };
  const entry = { id: "owned", seq: 1, op: "send", args: { private: "device-approved" }, new_ids: [], predicted: [] };
  const sent = [], requests = [];
  let entries = [entry], attempted;
  const started = new Promise(resolve => { attempted = resolve; });
  const core = {
    async call(request) {
      requests.push(request);
      switch (request.op) {
        case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, pending_ids: entries.map(e => e.id) } };
        case "state": return { ok: { watermark: 0, generation: 1 } };
        case "backend": return { ok: backend };
        case "queued": return { ok: entries };
        case "next_submission": return { ok: 2 };
        case "meta": return { ok: null };
        case "apply": return { ok: { touched: [] } };
        case "begin_send": attempted(); return superseded && request.ids?.includes("owned") ? denied : { ok: { send_revision: 1 } };
        case "settle": entries = []; return { ok: null };
        default: return { ok: null };
      }
    },
    async close() {},
  };
  const client = await local.createLocalClient({
    url: "https://outbox.invalid", persona: "bob", device: { open: async () => core },
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, generation: 1, more: false });
      if (path === "/changes") return new Promise((_, reject) => { init.signal?.throwIfAborted(); init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }); });
      if (path === "/m/send") { sent.push({ body: JSON.parse(init.body), headers: init.headers }); return Response.json({ state: "sent", id: "owned", seq: 1 }); }
      throw new Error(`unexpected request ${path}`);
    },
  });
  try {
    await started;
    await new Promise(resolve => setTimeout(resolve, 20));
    if (superseded) assert.deepEqual(sent, [], "captured arguments crossed the device's send refusal");
    else {
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].body, { id: "owned", args: entry.args, newIds: [] });
      assert.equal(sent[0].headers["x-snapback-persona"], "bob");
    }
    assert.deepEqual(Array.from(requests.find(r => r.op === "begin_send").ids ?? []), ["owned"]);
  } finally { await client.close(); }
});

test("journal capture order advances past other principals without replaying them", () => {
  const f = restoreHarness(null);
  const prior = JSON.parse(f.storage.get(f.key));
  prior.entry.seq = 10;
  f.storage.set(f.key, JSON.stringify(prior));
  const journal = new f.journal.AdmissionJournal("primary", true, "password:new");
  journal.load(f.saved.filter(c => c.s !== "j"));
  const captured = journal.capture({ entry: { ...prior.entry, id: "new", seq: 1, viewer: "password:new" } });
  assert.equal(captured.entry.seq, 11);
  assert.equal(f.storage.get(f.key), JSON.stringify(prior));
});

for (const location of ["denied", "restore_refusal"]) {
  test(`W2: journal recovery and fencing reject ${location} before side effects`, async () => {
    const f = restoreHarness(null);
    const journal = new f.journal.AdmissionJournal("primary", true, "guest:old");
    const device = { call() { return JSON.stringify(location === "denied" ? denied : { ok: { ...healthyState, restore_refusal: denied.denied } }); } };
    await assert.rejects(journal.recover(device, async () => { throw new Error("must not settle"); }), e => f.journal.historyOwnerRefusal(e));
    assert.throws(() => journal.fence(device), e => f.journal.historyOwnerRefusal(e));
    assert.equal(f.storage.get(f.key), f.journalBefore);
  });
}

test("W2: an ordinary backend-restore halt remains inspectable and cannot recover", async () => {
  const f = restoreHarness(null);
  const journal = new f.journal.AdmissionJournal("primary", true, "guest:old");
  const state = { ...healthyState, restore_refusal: { code: "E_STORE_RESTORE" } };
  const device = { call() { return JSON.stringify({ ok: state }); } };
  assert.equal(f.journal.checkedSyncState(device).restore_refusal.code, "E_STORE_RESTORE");
  await journal.recover(device, async () => { throw new Error("must not settle"); });
  assert.equal(f.storage.get(f.key), f.journalBefore);
});
