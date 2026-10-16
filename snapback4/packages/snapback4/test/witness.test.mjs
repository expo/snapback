import { hangBudget } from './helpers/wait.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test('prepared launch requires a native observation and preserves its hashes in the strict envelope', async () => {
  const { createWitness } = await import('../../snapback4-expo/src/witness-core.ts');
  const lines = [], container = { witnessLaunch: JSON.stringify({ segment: 'prime', timeoutMs: hangBudget(), proof: { sha256: 'expected' } }),
    witnessAppend: line => lines.push(JSON.parse(line)), witnessSignaled: () => true };
  assert.throws(() => createWitness(container), /E_WITNESS_PROOF/);
  const runtime = { scriptURL: 'file:///app/main.jsbundle', dev: false, hermes: true, launcherManifestPresent: false, updatesPresent: false, updatesManifestPresent: false };
  const native = { ...container, witnessObservation: url => {
    assert.equal(url, runtime.scriptURL);
    return { format: 2, javascriptSha256: 'native-read', executableSha256: 'native-exe' };
  } };
  for (const change of [{ scriptURL: null }, { scriptURL: 'http://localhost:8081/index.bundle' }, { dev: true }, { hermes: false }, { launcherManifestPresent: true }, { updatesPresent: true }, { updatesManifestPresent: true }]) {
    assert.throws(() => createWitness(native, { ...runtime, ...change }), /E_WITNESS_PROOF/);
  }
  assert.ok(lines.every(row => row.witness.step === "launched:failed"));
  lines.length = 0;
  createWitness(native, runtime);
  assert.equal(lines[0].startup.dev, false);
  assert.equal(lines[0].startup.javascriptSha256, 'native-read');
  assert.deepEqual(Object.keys(lines[0].witness).sort(), ['at', 'step']);
});

test("witness is inert without a launch; a fake container preserves receipts and gates reconnect", async () => {
  const { createWitness } = await import("../../snapback4-expo/src/witness-core.ts");
  assert.equal(createWitness(null), null);
  const dir = mkdtempSync(join(tmpdir(), "sb4-witness-helper-"));
  try {
    const w = createWitness({
      witnessLaunch: JSON.stringify({ segment: "offline", timeoutMs: hangBudget() }),
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
  const w = createWitness({ witnessLaunch: JSON.stringify({ segment: "offline", timeoutMs: hangBudget() }),
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

test('only empty launcher/update manifests permit prepared startup', async () => {
  const { manifestPresent } = await import('../../snapback4-expo/src/witness-core.ts');
  for (const value of [null, undefined, '', '{}', {}]) assert.equal(manifestPresent(value), false);
  for (const value of ['broken-json', '{"bundleUrl":"http://localhost"}', { metadata: {} }, 'null', 'true']) assert.equal(manifestPresent(value), true);
});

test('starter scene plugin migrates the installed Expo template, keeps its providers and refuses custom lifecycle', async () => {
  const { createRequire } = await import('node:module');
  const { spawnSync } = await import('node:child_process');
  const vm = await import('node:vm');
  const req = createRequire(import.meta.url);
  const template = spawnSync('tar', ['xOf', join(req.resolve('expo/package.json'), '..', 'template.tgz'), 'package/ios/HelloWorld/AppDelegate.swift'], { encoding: 'utf8' });
  assert.equal(template.status, 0, template.stderr);
  let appMod, infoMod;
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../snapback4-expo/plugin.cjs', import.meta.url), 'utf8'), { module, require: name => name === 'expo/config-plugins' ? {
    withAppDelegate: (c, fn) => { appMod = fn; return c; }, withInfoPlist: (c, fn) => { infoMod = fn; return c; },
    // This fixture exercises scene callbacks; real prebuild covers the SDK-cache mod.
    withDangerousMod: (c, [platform, fn]) => { assert.equal(platform, 'ios'); assert.equal(typeof fn, 'function'); return c; },
  } : req(name) });
  module.exports({});
  const config = { modResults: { language: 'swift', contents: template.stdout } };
  appMod(config);
  assert.ok(!config.modResults.contents.includes('window = UIWindow(frame: UIScreen.main.bounds)'));
  for (const term of ['RCTAppDependencyProvider()', 'ExpoReactNativeFactory(delegate:', 'class SceneDelegate:', 'UIWindow(windowScene: scene)', 'connectionOptions.userActivities', 'connectionOptions.urlContexts', 'in: window']) assert.ok(config.modResults.contents.includes(term), term);
  const once = config.modResults.contents;
  appMod(config); assert.equal(config.modResults.contents, once);
  const info = { modResults: {} }; infoMod(info); infoMod(info);
  assert.equal(info.modResults.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).SceneDelegate');
  assert.throws(() => appMod({ modResults: { language: 'swift', contents: 'custom app delegate' } }), /migrate custom/);
  assert.throws(() => infoMod({ modResults: { UIApplicationSceneManifest: { custom: true } } }), /refuses a custom/);
});

test('starter unattended guest waits for restoration and runs once only during smoke prime', async () => {
  const vm = await import('node:vm');
  const source = readFileSync(new URL('../../../crates/snapback4/src/verbs/init/native-smoke.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function', 'function');
  for (const segment of [null, 'prime', 'offline', 'restart']) {
    let state = 'restoring', calls = 0;
    const ref = { current: false };
    const context = vm.createContext({ useAuth: () => ({ state, guest: async () => { calls++; } }), useEffect: fn => fn(), useRef: () => ref, smokeSegment: () => segment });
    vm.runInContext(source, context);
    vm.runInContext('useNativeSmokeGuest()', context); assert.equal(calls, 0);
    state = 'signed-in'; vm.runInContext('useNativeSmokeGuest()', context); assert.equal(calls, 0);
    state = 'signed-out'; vm.runInContext('useNativeSmokeGuest(); useNativeSmokeGuest()', context);
    assert.equal(calls, segment === 'prime' ? 1 : 0);
  }
});
