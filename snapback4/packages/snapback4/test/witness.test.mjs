import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("witness is inert without a launch; a fake container preserves receipts and gates reconnect", async () => {
  const { createWitness } = await import("../../snapback4-expo/src/witness-core.ts");
  assert.equal(createWitness(null), null);
  const dir = mkdtempSync(join(tmpdir(), "sb4-witness-helper-"));
  try {
    const w = createWitness({
      witnessLaunch: JSON.stringify({ segment: "offline", timeoutMs: 1000 }),
      witnessAppend: (line) => appendFileSync(join(dir, "receipts.jsonl"), line),
      witnessSignaled: (label) => existsSync(join(dir, label)),
    });
    assert.equal(w.segment, "offline");
    const appReceipt = { arbitrary: { schema: [1, null, "hello"] }, pass: true };
    await w.step("history", async () => w.receipt(appReceipt));
    let reconnected = false;
    const wait = w.waitFor("reconnect").then(() => { reconnected = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(reconnected, false);
    writeFileSync(join(dir, "reconnect"), "ready");
    await wait;
    const rows = readFileSync(join(dir, "receipts.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(rows[0], { ...appReceipt, witness: { at: rows[0].witness.at, step: "history:running" } });
    assert.equal(rows[1].witness.step, "history");
    assert.deepEqual(appReceipt, { arbitrary: { schema: [1, null, "hello"] }, pass: true });
    assert.ok(Number.isFinite(Date.parse(rows[0].witness.at)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("witness refuses malformed receipts, failed and overlapping steps, and missing signals", async () => {
  const { createWitness } = await import("../../snapback4-expo/src/witness-core.ts");
  assert.equal(createWitness({ witnessLaunch: null }), null);
  const lines = [];
  const w = createWitness({ witnessLaunch: JSON.stringify({ segment: "restart", timeoutMs: 10 }),
    witnessAppend: line => lines.push(JSON.parse(line)), witnessSignaled: () => false });
  await assert.rejects(w.receipt({ witness: { keep: true } }), /E_WITNESS_RECEIPT/);
  await assert.rejects(w.step("broken", () => { throw Error("app assertion"); }), /app assertion/);
  assert.equal(lines.at(-1).witness.step, "broken:failed");
  assert.equal(lines.some(row => row.witness.step === "broken"), false);
  let release;
  const pending = w.step("first", () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(w.step("second", () => {}), /sequential/);
  release(42);
  assert.equal(await pending, 42);
  await assert.rejects(w.waitFor("reconnect"), /E_WITNESS_TIMEOUT/);
  await assert.rejects(w.waitFor("../reconnect"), /invalid signal/);
});

test("Expo package exports the witness and its types", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../snapback4-expo/package.json", import.meta.url)));
  assert.deepEqual(pkg.exports["./witness"], { types: "./src/witness.ts", default: "./src/witness.ts" });
  assert.ok(pkg.files.includes("src"));
  assert.ok(pkg.files.includes("ios"));
});


test("receipt serialization cannot replace the witness envelope", async () => {
  const { createWitness } = await import("../../snapback4-expo/src/witness-core.ts");
  const lines = [];
  const w = createWitness({ witnessLaunch: JSON.stringify({ segment: "offline", timeoutMs: 1000 }),
    witnessAppend: line => lines.push(JSON.parse(line)), witnessSignaled: () => true });
  for (const value of ["not-an-object", [], null, { witness: { step: "done" } }]) {
    await assert.rejects(w.receipt({ toJSON() { return value; } }), /E_WITNESS_RECEIPT/);
  }
  await w.receipt({ toJSON() { return { app: "serialized" }; } });
  let calls = 0;
  await w.receipt({ get app() { calls++; return { nested: true }; } });
  assert.equal(calls, 1);
  assert.deepEqual(lines.map(row => row.app), ["serialized", { nested: true }]);
  for (const row of lines) { assert.equal(row.witness.step, "launched"); assert.ok(Number.isFinite(Date.parse(row.witness.at))); }
  const object = { get app() { object.witness = { step: "done" }; return true; } };
  await w.receipt(object);
  assert.equal(lines.at(-1).witness.step, "launched");
});
