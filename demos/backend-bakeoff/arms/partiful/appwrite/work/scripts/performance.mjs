import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { Permission, Query, Role } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import {
  actorClient,
  databaseId,
  runtime,
  storage,
  tableIds,
  tables,
} from "./admin-client.mjs";
import { namespace, receiptsRoot, vitePort, workRoot } from "./constants.mjs";

// @ref LLP 0102#app-4-partiful-shaped-event-application — Frozen two-warmup/seven-sample performance paths.
const warmups = 2;
const recorded = 7;
const runs = warmups + recorded;
const round = (value) => Number(value.toFixed(3));
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    rawSamplesMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
async function measure(operation) {
  const values = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await operation(index);
    if (index >= warmups) values.push(round(performance.now() - started));
  }
  return summarize(values);
}
const [alice, bob, mallory] = await Promise.all([actorClient("alice"), actorClient("bob"), actorClient("mallory")]);
const priorPerformanceRows = await tables.listRows({
  databaseId, tableId: tableIds.wallPosts, queries: [Query.limit(500)], total: true,
});
for (const row of priorPerformanceRows.rows.filter((row) => row.$id.startsWith("perf-"))) {
  await tables.deleteRow({ databaseId, tableId: tableIds.wallPosts, rowId: row.$id });
}
const capacityPermissions = [
  Permission.read(Role.any()), Permission.update(Role.user("alice")), Permission.delete(Role.user("alice")),
  Permission.update(Role.user("bob")), Permission.update(Role.user("mallory")),
];

const contention = await measure(async () => {
  await tables.updateRow({
    databaseId, tableId: tableIds.events, rowId: "event-20",
    data: { yes_count: 49 }, permissions: capacityPermissions,
  });
  for (const [rowId, status] of [["invite-event-20-bob", "invited"], ["invite-event-20-mallory", "invited"]]) {
    await tables.updateRow({ databaseId, tableId: tableIds.invitations, rowId, data: { status } });
  }
  const [left, right] = await Promise.all([bob.tables.createTransaction(), mallory.tables.createTransaction()]);
  await Promise.all([
    bob.tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-20", data: { yes_count: 50 }, transactionId: left.$id }),
    bob.tables.updateRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-20-bob", data: { status: "yes" }, transactionId: left.$id }),
    mallory.tables.updateRow({ databaseId, tableId: tableIds.events, rowId: "event-20", data: { yes_count: 50 }, transactionId: right.$id }),
    mallory.tables.updateRow({ databaseId, tableId: tableIds.invitations, rowId: "invite-event-20-mallory", data: { status: "yes" }, transactionId: right.$id }),
  ]);
  const outcome = await Promise.allSettled([
    bob.tables.updateTransaction({ transactionId: left.$id, commit: true }),
    mallory.tables.updateTransaction({ transactionId: right.$id, commit: true }),
  ]);
  if (outcome.filter((item) => item.status === "fulfilled").length !== 1) throw new Error("Contention sample changed");
});

const burst = await measure(async (run) => {
  const burstRows = Array.from({ length: 20 }, (_, offset) => {
    const sequence = offset + 1;
    const rowId = `perf-b${run}-${String(sequence).padStart(2, "0")}`;
    return {
      $id: rowId,
      $permissions: [Permission.read(Role.user("bob")), Permission.update(Role.user("bob"))],
      event_id: "event-02", author_id: "bob",
      body: `Performance burst ${run}/${sequence}`, sequence: 2000 + run * 20 + sequence,
    };
  });
  const ids = burstRows.map((row) => row.$id);
  await tables.createRows({ databaseId, tableId: tableIds.wallPosts, rows: burstRows });
  await tables.updateRow({
    databaseId, tableId: tableIds.events, rowId: "event-20",
    data: { maybe_count: run % 2 }, permissions: capacityPermissions,
  });
  const authoritative = await Promise.all(ids.map((rowId) =>
    tables.getRow({ databaseId, tableId: tableIds.wallPosts, rowId })));
  if (authoritative.length !== 20) throw new Error("Burst sample changed");
  for (const rowId of ids) await tables.deleteRow({ databaseId, tableId: tableIds.wallPosts, rowId });
});

const assetBytes = Buffer.alloc(262144, 0x5a);
const asset = await measure(async (run) => {
  const fileId = `perf-art-${run}`;
  const uploaded = await alice.storage.createFile({
    bucketId: "event-art", fileId,
    file: InputFile.fromBuffer(assetBytes, `${fileId}.bin`),
    permissions: [Permission.read(Role.user("alice")), Permission.delete(Role.user("alice"))],
  });
  const downloaded = Buffer.from(await alice.storage.getFileDownload({ bucketId: "event-art", fileId }));
  if (uploaded.sizeOriginal !== assetBytes.length || downloaded.length !== assetBytes.length) throw new Error("Asset sample changed");
  await alice.storage.deleteFile({ bucketId: "event-art", fileId });
});

await tables.updateTable({
  databaseId, tableId: tableIds.wallPosts,
  permissions: [Permission.create(Role.users()), Permission.read(Role.user("bob"))],
  rowSecurity: true, enabled: true, purge: true,
});
const browserRoot = path.resolve(workRoot, ".browser-runtime/performance-partiful");
await mkdir(browserRoot, { recursive: true });
const context = await chromium.launchPersistentContext(browserRoot, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = context.pages()[0] ?? await context.newPage();
let websocketCount = 0;
page.on("websocket", (socket) => { if (socket.url().includes("/v1/realtime")) websocketCount += 1; });
await page.goto(`http://127.0.0.1:${vitePort}`);
await page.locator('[data-testid="partiful-shell"]').waitFor();
await page.waitForTimeout(1_000);
if (!await page.locator('[data-testid="partiful-shell"][data-ready="true"]').isVisible().catch(() => false)) {
  await page.getByLabel("Email").fill(runtime.personas.bob.email);
  await page.getByLabel("Password").fill(runtime.personas.bob.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
await page.locator('[data-testid="partiful-shell"][data-ready="true"]').waitFor({ timeout: 30_000 });
await page.waitForTimeout(2_000);
const realtime = await measure(async (run) => {
  const before = Number(await page.locator('[data-testid="partiful-shell"]').getAttribute("data-realtime-walls"));
  const rowId = `perf-live-${run}`;
  await bob.tables.createRow({
    databaseId, tableId: tableIds.wallPosts, rowId,
    data: { event_id: "event-02", author_id: "bob", body: `Realtime sample ${run}`, sequence: 3000 + run },
    permissions: [Permission.read(Role.user("bob"))],
  });
  await page.waitForFunction((value) =>
    Number(document.querySelector('[data-testid="partiful-shell"]')?.getAttribute("data-realtime-walls")) > value,
  before);
  await tables.deleteRow({ databaseId, tableId: tableIds.wallPosts, rowId });
});
await context.close();

const deployBuild = await measure(async () => {
  const result = spawnSync("npm", ["run", "build", "--silent"], { cwd: workRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Build sample failed");
});

const dockerStats = spawnSync("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { encoding: "utf8" })
  .stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  .filter((entry) => entry.Name === runtime.effectSinkContainer || entry.Name === "exc1" || entry.Name.startsWith("appwrite"));
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  claimScope: "isolated local Appwrite 1.9.6 self-host stack; not hosted or production latency",
  frozenDataset: { events: 20, contendedGuests: 49, capacity: 50, wallBurst: 20, assetBytes: 262144, actors: 3, concurrentClients: 2 },
  warmupsPerPath: warmups,
  recordedSamplesPerPath: recorded,
  statistic: "median and nearest-rank p95 over seven retained measurements",
  paths: { contention, burst, asset, realtime, deployBuild },
  realtimeWebSocketsObserved: websocketCount,
  productPolling: false,
  dockerResources: {
    composeProject: namespace,
    containerSnapshots: dockerStats.map(({ Name, MemUsage, CPUPerc }) => ({ name: Name, memory: MemUsage, cpu: CPUPerc })),
  },
  machine: { architecture: process.arch, host: "Mac17,3", dockerCpus: 4, dockerMemory: "8 GiB", node: process.version },
  costWindow: {
    measuredProviderCharge: "$0.00",
    basis: "open-source Appwrite software in an arm-owned local Colima VM; host compute excluded",
    hostedActualUsage: "unavailable — no hosted target credentials",
    hostedListPriceEstimate: "not claimed",
  },
};
await writeFile(path.resolve(receiptsRoot, "performance.v1.json"), `${JSON.stringify(receipt, null, 2)}\n`);
const scenario = {
  id: "PARTY-14-PERFORMANCE", status: "pass", checkedAt: receipt.checkedAt, projectId: namespace,
  transport: "appwrite-realtime-websocket",
  evidence: receipt,
  note: "Two warmups and seven retained samples cover frozen contention, burst, asset, Realtime, and deploy/build paths.",
};
await writeFile(path.resolve(receiptsRoot, "scenarios/PARTY-14-PERFORMANCE.json"), `${JSON.stringify(scenario, null, 2)}\n`);
const acceptancePath = path.resolve(receiptsRoot, "acceptance-results.v1.json");
const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
const index = acceptance.scenarios.findIndex((item) => item.id === scenario.id);
acceptance.scenarios[index] = scenario;
acceptance.statusCounts = acceptance.scenarios.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] ?? 0) + 1 }), {});
acceptance.milestones.localAcceptanceMs = Date.now() - Date.parse(JSON.parse(await readFile(path.resolve(receiptsRoot, "baseline.v1.json"))).capturedAt);
acceptance.milestones.acceptanceCompletionMs = acceptance.milestones.localAcceptanceMs;
await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, paths: Object.keys(receipt.paths), warmups, recorded, websocketCount }));
