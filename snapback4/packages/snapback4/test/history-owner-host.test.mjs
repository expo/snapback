// Exercise the actual host/journal sources with a device boundary double. This
// does not build or load wasm: Rust device behavior has its own crate tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const denied = { denied: { code: "SNAPBACK_HISTORY_OWNER", family: "structural", message: "preserve the original store" } };
const healthyState = { store_id: "store", backend_required: false, send_revision: 1 };

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
  const context = vm.createContext({ console, TextEncoder, window: {}, localStorage, URL });
  const modules = new Map();
  function load(file, extra = "") {
    const url = new URL(`../src/${file}`, import.meta.url);
    const source = readFileSync(url, "utf8").replaceAll("import.meta.url", JSON.stringify(url.href));
    const compiled = ts.transpileModule(source + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    const require = name => {
      if (name === "./wasm/snapback4_device.js") return { WebDevice };
      if (name === "./writes.ts") return { WRITE_HISTORY_LIMIT: 100 };
      if (modules.has(name)) return modules.get(name);
      throw new Error(`unexpected import ${name}`);
    };
    vm.runInContext(`(function(exports, require) { ${compiled}\n})`, context)(exports, require);
    return exports;
  }
  const journal = load("web-journal.ts"); modules.set("./web-journal.ts", journal);
  const web = load("web.ts", "\nexport { adoptOrphans };\n");
  const persist = {
    others: async () => [...sources.keys()],
    claim: async name => ({ name, async release() { released.push(name); } }),
    load: async name => sources.get(name),
    save: async (name, changes) => { saves.push(name); sources.set(name, [...sources.get(name), ...changes]); },
    remove: async name => { removed.push(name); sources.delete(name); },
  };
  const destination = { call(text) {
    const request = JSON.parse(text);
    if (request.op === "sync_state") return JSON.stringify({ ok: healthyState });
    if (request.op === "backend") return JSON.stringify({ ok: {} });
    if (request.op === "queued") return JSON.stringify({ ok: [] });
    if (request.op === "next_submission") return JSON.stringify({ ok: 1 });
    if (request.op === "enqueue") { imported.push(request.entry.id); return JSON.stringify({ ok: null }); }
    throw new Error(`unexpected destination call ${request.op}`);
  } };
  return { journal, sources, orphan, healthy, before, storage, journalKey, journalBefore, saves, removed, released, imported, calls,
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
