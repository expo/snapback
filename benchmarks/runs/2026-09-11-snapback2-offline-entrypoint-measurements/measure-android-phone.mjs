#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as proxyRequest } from "node:http";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = resolve(process.env.SNAPBACK_WORKSPACE ?? process.cwd(), "snapback2");
const deviceHost = process.env.SNAPBACK_PHONE_HOST ?? "ccheever@charlies-mac-mini-bones-m416.local";
const device = process.env.SNAPBACK_PHONE_SERIAL ?? "00333366J002730";
const controlPort = 43219;
const ownerPort = 43220;
const adbTunnelPort = 5038;
const bundleId = "dev.snapback.chat";
const output = resolve(process.env.SNAPBACK_PHONE_RESULT ?? `${workspace}/target/offline-entrypoint-phone-result.json`);
const resumePopulated = process.env.SNAPBACK_PHONE_RESUME_POPULATED === "1";
const { binary, dist, environment, prepareExpoProject, project, run, walk } = await import(pathToFileURL(resolve(workspace, "scripts/expo-project.mjs")));
const { controlServer } = await import(pathToFileURL(resolve(workspace, "scripts/witness-expo/control.mjs")));
const { ownerHarness } = await import(pathToFileURL(resolve(workspace, "scripts/witness-expo/owner.mjs")));

const androidSdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
if (!androidSdk) throw new Error("set ANDROID_SDK_ROOT or ANDROID_HOME");
const adb = resolve(androidSdk, "platform-tools/adb");

function start(command, args) {
  return spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
}

async function waitFor(predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`timed out: ${label}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function adbRun(args, timeout = 60_000) {
  return run(adb, ["-H", "127.0.0.1", "-P", String(adbTunnelPort), "-s", device, ...args], { timeout });
}

function seedSource() {
  const conversations = Array.from({ length: 50 }, (_, index) => ({
    id: `conversation-${String(index).padStart(2, "0")}`,
    title: `Scale lane ${String(index).padStart(2, "0")}`,
    creatorId: "dev:alice",
  }));
  const memberships = conversations.map((conversation, index) => ({
    id: `membership-${String(index).padStart(2, "0")}`,
    conversationId: conversation.id,
    principal: "dev:alice",
    role: "admin",
    joinedAt: 0,
  }));
  // The permanent seed establishes the 50 bounded scopes. The 10,000 source
  // rows are then admitted through the app's real mutation below: expressing
  // all of them as one seed certificate would honestly exceed the unchanged
  // 10,240-rule-probe ceiling.
  return `import { seed } from "snapback2";\n\nexport default seed(${JSON.stringify({ personas: ["alice"], rows: { conversations, memberships } }, null, 2)});\n`;
}

async function populateScaleRows(url) {
  const { api, createClient } = await import(pathToFileURL(resolve(dist, "client.mjs")));
  const client = createClient({ url, persona: "alice" });
  const startedAt = Date.now();
  let committed = 0;
  try {
    for (let offset = 0; offset < 10_000; offset += 50) {
      const results = await Promise.all(Array.from({ length: Math.min(50, 10_000 - offset) }, (_, slot) => {
        const index = offset + slot;
        return client.mutation(api.messages.send, {
          conversationId: `conversation-${String(index % 50).padStart(2, "0")}`,
          body: `scale ${String(index).padStart(5, "0")} ${"x".repeat(488)}`,
        });
      }));
      for (const result of results) {
        assert.equal(result.state, "committed", JSON.stringify(result));
        committed++;
      }
    }
    return { committed, elapsedMs: Date.now() - startedAt, admission: "messages.send mutation, 50 concurrent envelopes per batch" };
  } finally { await client.close(); }
}

async function verifyScaleRows(url) {
  const { api, createClient } = await import(pathToFileURL(resolve(dist, "client.mjs")));
  const client = createClient({ url, persona: "alice" });
  try {
    const counts = await Promise.all(Array.from({ length: 50 }, async (_, index) => {
      const result = await client.query(api.messages.conversationView, { conversationId: `conversation-${String(index).padStart(2, "0")}` });
      return Number(result?.data?.count ?? -1);
    }));
    assert.deepEqual(new Set(counts), new Set([200]), JSON.stringify(counts));
    return { conversations: counts.length, messages: counts.reduce((sum, count) => sum + count, 0), perConversation: 200 };
  } finally { await client.close(); }
}

async function linkMetroTransitiveDependency() {
  const expo = await realpath(resolve(project, "node_modules/expo"));
  const bunRoot = resolve(expo, "../../..");
  const entry = (await readdir(bunRoot)).find((name) => name.startsWith("expo-modules-core@"));
  if (!entry) throw new Error(`expo-modules-core installation absent under ${bunRoot}`);
  const link = resolve(project, "node_modules/expo-modules-core");
  try { await symlink(resolve(bunRoot, entry, "node_modules/expo-modules-core"), link); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  // This reusable worktree borrows its ignored Bun installation from the
  // sibling main checkout. Metro must watch that real symlink target or it
  // declines the otherwise-present expo-modules-core package.
  const dependencyWorkspace = resolve(bunRoot, "../..");
  const metroPath = resolve(project, "metro.config.cjs");
  let metro = await readFile(metroPath, "utf8");
  metro = metro.replace(
    "config.watchFolders = [process.env.SNAPBACK2_EXPO_WORKSPACE];",
    `config.watchFolders = [process.env.SNAPBACK2_EXPO_WORKSPACE, ${JSON.stringify(dependencyWorkspace)}];`,
  );
  await writeFile(metroPath, metro);
}

async function resumedOwnerHarness(port) {
  let url;
  const server = createServer((incoming, outgoing) => {
    if (!url) { outgoing.writeHead(503); outgoing.end(); return; }
    const upstream = proxyRequest(new URL(incoming.url, url), { method: incoming.method, headers: incoming.headers }, (response) => {
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    upstream.on("error", () => { outgoing.writeHead(503); outgoing.end(); });
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  return {
    url: `http://127.0.0.1:${port}`,
    get directUrl() { return url; },
    async start() {
      const info = JSON.parse(await run(binary, ["dev", "--project", project, "--json"], { cwd: workspace, timeout: 30_000 }));
      url = info.url;
      return info;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await run(binary, ["dev", "--project", project, "--stop", "--json"], { cwd: workspace }).catch(() => {});
    },
  };
}

async function addCompactMetrics() {
  const statePath = resolve(project, "src/witness-state.ts");
  const witnessPath = resolve(project, "src/Witness.tsx");
  let state = await readFile(statePath, "utf8");
  state = state.replace(
    'import { expoSqliteDriver } from "snapback2/expo";',
    'import { expoSqliteDriver } from "snapback2/expo";\nimport { defaultDatabaseDirectory } from "expo-sqlite";',
  );
  await writeFile(statePath, `${state}\nexport async function compactDatabaseMetrics(): Promise<Record<string, unknown>> {\n  const driver = expoSqliteDriver(DATABASE);\n  try {\n    const tableCounts: Record<string, number> = {};\n    for (const table of ["state", "metadata", "rows", "answers", "outbox", "bytes"]) {\n      const rows = await driver.all<Record<string, unknown>>(\`SELECT COUNT(*) AS count FROM \${table}\`);\n      tableCounts[table] = Number(rows[0]?.count ?? 0);\n    }\n    const pageCountRow = (await driver.all<Record<string, unknown>>("PRAGMA page_count"))[0] ?? {};\n    const pageSizeRow = (await driver.all<Record<string, unknown>>("PRAGMA page_size"))[0] ?? {};\n    const freelistRow = (await driver.all<Record<string, unknown>>("PRAGMA freelist_count"))[0] ?? {};\n    const pageCount = Number(Object.values(pageCountRow)[0] ?? 0);\n    const pageSize = Number(Object.values(pageSizeRow)[0] ?? 0);\n    const freelistCount = Number(Object.values(freelistRow)[0] ?? 0);\n    const databaseFiles: Record<string, number> = {};\n    for (const suffix of ["", "-wal", "-shm"]) {\n      const file = new File(defaultDatabaseDirectory, \`\${DATABASE}\${suffix}\`);\n      if (file.exists) databaseFiles[file.uri] = file.size;\n    }\n    return { tableCounts, pageCount, pageSize, freelistCount, sqliteAllocatedBytes: pageCount * pageSize, databaseFiles, totalDatabaseFileBytes: Object.values(databaseFiles).reduce((sum, bytes) => sum + bytes, 0) };\n  } finally { await driver.close(); }\n}\n`);
  let witness = await readFile(witnessPath, "utf8");
  witness = witness.replace(
    'import { configuration, persist, databaseState, markerSwap, listFiles, DATABASE } from "./witness-state";',
    'import { configuration, persist, databaseState, markerSwap, listFiles, DATABASE, compactDatabaseMetrics } from "./witness-state";',
  );
  witness = witness.replace(
    '        if (verb === "settled") {',
    `        if (verb === "measure") {\n          const inbox = await client.query(api.messages.inbox, { c: null });\n          const search = await client.query(api.messages.search, { term: "scale", c: null });\n          const compact = (answer: unknown) => {\n            const value = answer as { state?: unknown; data?: unknown[]; next?: unknown; reason?: unknown };\n            return { state: value?.state, rows: Array.isArray(value?.data) ? value.data.length : null, next: value?.next ?? null, reason: value?.reason ?? null };\n          };\n          return { snapshot: client.snapshot, inbox: compact(inbox), search: compact(search), database: await compactDatabaseMetrics() };\n        }\n        if (verb === "settled") {`,
  );
  if (!witness.includes('verb === "measure"')) throw new Error("failed to install compact phone metrics command");
  await writeFile(witnessPath, witness);
}

async function buildApk(cli, buildEnv) {
  await run(process.execPath, [cli, "prebuild", "--platform", "android", "--no-install"], {
    cwd: project, env: buildEnv, timeout: 600_000,
  });
  const manifestPath = resolve(project, "android/app/src/main/AndroidManifest.xml");
  let manifest = await readFile(manifestPath, "utf8");
  manifest = manifest.replace(/(?: android:debuggable="true")+/g, "");
  await writeFile(manifestPath, manifest);
  await run(resolve(project, "android/gradlew"), [":app:assembleRelease", "--no-daemon"], {
    cwd: resolve(project, "android"), env: buildEnv, timeout: 1_800_000,
  });
  const apks = (await walk(resolve(project, "android/app/build/outputs/apk/release"))).filter((path) => path.endsWith(".apk"));
  assert.equal(apks.length, 1, JSON.stringify(apks));
  return apks[0];
}

function valueFromStatus(status, key) {
  const match = status.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m"));
  return match ? Number(match[1]) * 1024 : null;
}

function meminfoSummary(value) {
  const number = (label) => {
    const match = value.match(new RegExp(`${label}:\\s+([\\d,]+)`, "i"));
    return match ? Number(match[1].replaceAll(",", "")) * 1024 : null;
  };
  return { totalPssBytes: number("TOTAL PSS"), totalRssBytes: number("TOTAL RSS"), totalSwapPssBytes: number("TOTAL SWAP PSS") };
}

async function sampleResident(pid, operation) {
  let sampling = true;
  const samples = [];
  const loop = (async () => {
    while (sampling) {
      try {
        const observedAt = new Date().toISOString();
        const summary = meminfoSummary(await adbRun(["shell", "dumpsys", "meminfo", "-d", pid], 15_000));
        if (summary.totalRssBytes !== null) samples.push({ observedAt, ...summary });
      } catch {}
      if (sampling) await new Promise((done) => setTimeout(done, 250));
    }
  })();
  try { return { value: await operation(), samples }; }
  finally { sampling = false; await loop; }
}

const receipt = {
  schemaVersion: "snapback2.offline-entrypoint-phone.v1",
  observedAt: new Date().toISOString(),
  sourceCommit: null,
  productCommit: process.env.SNAPBACK_PRODUCT_COMMIT ?? null,
  deviceHost,
  device: null,
  workload: { personas: 1, conversations: 50, memberships: 50, messages: 10_000, messageBodyCharacters: 500 },
  result: "fail",
};
let tunnel;
let control;
let owner;
let ownerProcess;
try {
  receipt.sourceCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: resolve(workspace, "..") })).trim();
  tunnel = start("ssh", ["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=7",
    "-L", `${adbTunnelPort}:127.0.0.1:5037`, "-R", `${controlPort}:127.0.0.1:${controlPort}`,
    "-R", `${ownerPort}:127.0.0.1:${ownerPort}`, deviceHost]);
  let tunnelError = "";
  tunnel.stderr.on("data", (chunk) => { tunnelError += String(chunk); });
  await waitFor(async () => {
    try { return (await run(adb, ["-H", "127.0.0.1", "-P", String(adbTunnelPort), "devices"], { timeout: 2_000 })).includes(device); }
    catch { if (tunnel.exitCode !== null) throw new Error(`SSH tunnel exited: ${tunnelError}`); return false; }
  }, "remote adb tunnel", 20_000);
  const [model, sdk, release, fingerprint] = await Promise.all([
    adbRun(["shell", "getprop", "ro.product.model"]), adbRun(["shell", "getprop", "ro.build.version.sdk"]),
    adbRun(["shell", "getprop", "ro.build.version.release"]), adbRun(["shell", "getprop", "ro.build.fingerprint"]),
  ]);
  receipt.device = { serial: device, model: model.trim(), sdk: sdk.trim(), release: release.trim(), fingerprint: fingerprint.trim(), transport: "USB on device host through an SSH-forwarded adb server" };
  assert.equal(receipt.device.sdk, "36");

  control = await controlServer(controlPort);
  await run("cargo", ["build", "-p", "snapback2", "-p", "snapback2-media"], { cwd: workspace, timeout: 1_200_000 });
  await run(process.execPath, ["packages/snapback2/build.mjs"], { cwd: workspace, timeout: 300_000 });
  const { cli } = await prepareExpoProject();
  await writeFile(resolve(project, "snapback/seed.ts"), seedSource());
  await addCompactMetrics();
  await linkMetroTransitiveDependency();
  owner = resumePopulated ? await resumedOwnerHarness(ownerPort) : await ownerHarness(ownerPort);
  try {
    receipt.owner = await owner.start();
  } catch (error) {
    if (!String(error).includes("E_OWNER_START_TIMEOUT")) throw error;
    // The normal detached-dev acknowledgement is deliberately bounded at ten
    // seconds. A populated scale store can exceed that restart window, so keep
    // the documented foreground owner attached and wait for its real control
    // endpoint instead of weakening or splitting the workload.
    ownerProcess = spawn(binary, ["dev", "--project", project, "--foreground", "--json"], {
      cwd: project, env: environment, stdio: ["ignore", "pipe", "pipe"],
    });
    let foregroundLog = "";
    ownerProcess.stdout.on("data", (chunk) => { foregroundLog += String(chunk); });
    ownerProcess.stderr.on("data", (chunk) => { foregroundLog += String(chunk); });
    await waitFor(async () => {
      if (ownerProcess.exitCode !== null) throw new Error(`foreground owner exited ${ownerProcess.exitCode}: ${foregroundLog}`);
      try {
        const info = JSON.parse(await readFile(resolve(project, ".snapback/owner.json"), "utf8"));
        const response = await fetch(new URL("/control/status", info.url), { signal: AbortSignal.timeout(1_000) });
        return response.ok;
      } catch { return false; }
    }, "foreground owner after large seed", 300_000);
    receipt.owner = await owner.start();
    receipt.ownerStart = { mode: "foreground-large-seed", detachedTimeoutObserved: true };
  }
  const buildEnv = { ...environment,
    JAVA_HOME: process.env.JAVA_HOME,
    ANDROID_SDK_ROOT: androidSdk,
    NODE_ENV: "production",
    NODE_BINARY: process.execPath,
    EXPO_PUBLIC_SNAPBACK_URL: `http://127.0.0.1:${ownerPort}`,
    EXPO_PUBLIC_SNAPBACK_WITNESS: `ws://localhost:${controlPort}`,
  };
  receipt.population = resumePopulated
    ? { reusedExistingOwnerStore: true, verified: await verifyScaleRows(owner.directUrl) }
    : { ...await populateScaleRows(owner.directUrl), verified: await verifyScaleRows(owner.directUrl) };
  const apk = await buildApk(cli, buildEnv);
  receipt.apk = { path: apk, bytes: Number((await run("stat", ["-f", "%z", apk])).trim()) };
  await adbRun(["install", "-r", apk], 300_000);
  await adbRun(["reverse", `tcp:${controlPort}`, `tcp:${controlPort}`]);
  await adbRun(["reverse", `tcp:${ownerPort}`, `tcp:${ownerPort}`]);

  let generation = control.generation;
  await adbRun(["shell", "am", "force-stop", bundleId]);
  await adbRun(["shell", "am", "start", "-W", "-n", `${bundleId}/.MainActivity`]);
  await control.connected(generation);
  const pid = (await adbRun(["shell", "pidof", bundleId])).trim().split(/\s+/)[0];
  assert.match(pid, /^\d+$/);
  const startedAt = Date.now();
  const sampled = await sampleResident(pid, async () => {
    const constructed = await control.command("construct", { fresh: true, name: "alice", assets: [] }, 300_000);
    const drained = await control.command("drain", {}, 1_200_000);
    const liveMetrics = await control.command("measure", {}, 300_000);
    return { constructed, drained, liveMetrics };
  });
  const { constructed, drained, liveMetrics } = sampled.value;
  const liveElapsedMs = Date.now() - startedAt;
  const procStatus = await adbRun(["shell", "cat", `/proc/${pid}/status`]).catch(() => "");
  const dumpsys = await adbRun(["shell", "dumpsys", "meminfo", "-d", pid]);
  const sampledPeakRssBytes = Math.max(0, ...sampled.samples.map((sample) => sample.totalRssBytes ?? 0));
  const vmHwmBytes = valueFromStatus(procStatus, "VmHWM");
  receipt.liveColdBuild = {
    elapsedMs: liveElapsedMs,
    constructed,
    drained: { state: drained?.state ?? null, rows: Array.isArray(drained?.data) ? drained.data.length : null, next: drained?.next ?? null },
    metrics: liveMetrics,
    process: { pid: Number(pid), peakResidentBytes: vmHwmBytes ?? sampledPeakRssBytes, sampledPeakRssBytes,
      sampleCount: sampled.samples.length, vmPeakBytes: valueFromStatus(procStatus, "VmPeak"), vmHwmBytes, vmRssBytes: valueFromStatus(procStatus, "VmRSS") },
    residentSamples: sampled.samples,
    procStatus,
    dumpsysMeminfo: dumpsys,
  };
  assert.equal(liveMetrics.database.tableCounts.rows >= 10_000, true, JSON.stringify(liveMetrics));
  assert.equal(liveMetrics.database.sqliteAllocatedBytes > 0, true, JSON.stringify(liveMetrics));
  assert.equal(liveMetrics.database.totalDatabaseFileBytes > 0, true, JSON.stringify(liveMetrics));
  assert.equal(receipt.liveColdBuild.process.peakResidentBytes > 0, true, dumpsys);

  await control.command("offline", {}, 60_000);
  generation = control.generation;
  await adbRun(["shell", "am", "force-stop", bundleId]);
  await adbRun(["shell", "am", "start", "-W", "-n", `${bundleId}/.MainActivity`]);
  await control.connected(generation);
  const reopenStartedAt = Date.now();
  const reopened = await control.command("construct", {}, 300_000);
  const offlineMetrics = await control.command("measure", {}, 300_000);
  receipt.offlineColdReopen = { elapsedMs: Date.now() - reopenStartedAt, constructed: reopened, metrics: offlineMetrics };
  assert.equal(offlineMetrics.snapshot.connection, "offline", JSON.stringify(offlineMetrics));
  assert.equal(offlineMetrics.database.tableCounts.rows, liveMetrics.database.tableCounts.rows);
  assert.equal(offlineMetrics.database.sqliteAllocatedBytes, liveMetrics.database.sqliteAllocatedBytes);
  assert.equal(offlineMetrics.search.rows, 20, JSON.stringify(offlineMetrics));
  receipt.result = "pass";
} catch (error) {
  receipt.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (control) {
    await adbRun(["shell", "am", "force-stop", bundleId]).catch(() => {});
    await adbRun(["reverse", "--remove", `tcp:${controlPort}`]).catch(() => {});
    await adbRun(["reverse", "--remove", `tcp:${ownerPort}`]).catch(() => {});
  }
  await control?.close().catch(() => {});
  await owner?.close().catch(() => {});
  if (ownerProcess?.exitCode === null) ownerProcess.kill("SIGTERM");
  tunnel?.kill("SIGTERM");
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
