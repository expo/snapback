import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  Channel,
  Client as RealtimeClient,
  Realtime,
} from "appwrite";
import {
  actorClient,
  databaseId,
  endpoint,
  memberTeamId,
  Permission,
  projectId,
  Query,
  Role,
  tableIds,
  tables,
} from "./admin-client.mjs";
import { receiptsRoot, workRoot } from "./constants.mjs";

// @ref LLP 0102#resolved-setup-decisions — two warmups plus seven retained samples for each frozen product path.
globalThis.window ??= globalThis;
const [alice, bob] = await Promise.all([actorClient("alice"), actorClient("bob")]);
const actorPermissions = [
  Permission.read(Role.team(memberTeamId)),
  Permission.update(Role.user("alice")),
  Permission.delete(Role.user("alice")),
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const samples = {
  representativeRead: [],
  representativeWrite: [],
  realtimeDelivery: [],
  reconnect: [],
  build: [],
};
const warmups = {
  representativeRead: [],
  representativeWrite: [],
  realtimeDelivery: [],
  reconnect: [],
  build: [],
};
const summarize = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samplesMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95NearestRankMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
async function timed(operation) {
  const started = performance.now();
  await operation();
  return Number((performance.now() - started).toFixed(3));
}
async function readPath() {
  const result = await bob.tables.listRows({
    databaseId,
    tableId: tableIds.sources,
    queries: [
      Query.equal("room_id", ["research-main"]),
      Query.search("content_text", "cancellation"),
      Query.orderAsc("sequence"),
      Query.limit(20),
    ],
    total: true,
  });
  if (result.total !== 2) throw new Error("representative read fixture drift");
}
let writeSequence = 0;
async function writePath() {
  writeSequence += 1;
  const rowId = `perf-write-${String(writeSequence).padStart(2, "0")}`;
  await alice.tables.createRow({
    databaseId,
    tableId: tableIds.questions,
    rowId,
    data: {
      room_id: "research-main",
      asker_id: "alice",
      prompt: "performance write",
      idempotency_key: rowId,
      status: "queued",
      cancelled: false,
    },
    permissions: actorPermissions,
  });
  await alice.tables.deleteRow({
    databaseId,
    tableId: tableIds.questions,
    rowId,
  });
}

const deliveryClient = new RealtimeClient()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setSession(bob.sessionSecret);
const deliveryRealtime = new Realtime(deliveryClient);
const deliveryWaiters = new Map();
const deliverySubscription = await deliveryRealtime.subscribe(
  Channel.tablesdb(databaseId).table(tableIds.progress).row(),
  (message) => {
    const waiter = deliveryWaiters.get(message.payload?.$id);
    if (waiter) {
      deliveryWaiters.delete(message.payload.$id);
      waiter();
    }
  },
);
await sleep(750);
let realtimeSequence = 0;
async function realtimePath() {
  realtimeSequence += 1;
  const rowId = `perf-live-${String(realtimeSequence).padStart(2, "0")}`;
  const observed = new Promise((resolve) => deliveryWaiters.set(rowId, resolve));
  await tables.createRow({
    databaseId,
    tableId: tableIds.progress,
    rowId,
    data: {
      question_id: "question-progress",
      sequence: 100 + realtimeSequence,
      label: "performance",
    },
    permissions: actorPermissions,
  });
  await Promise.race([
    observed,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`realtime timeout ${rowId}`)),
      10_000,
    )),
  ]);
  await tables.deleteRow({
    databaseId,
    tableId: tableIds.progress,
    rowId,
  });
}

let reconnectSequence = 0;
async function reconnectPath() {
  reconnectSequence += 1;
  const rowId = `perf-reconnect-${String(reconnectSequence).padStart(2, "0")}`;
  const client = new RealtimeClient()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setSession(bob.sessionSecret);
  const realtime = new Realtime(client);
  let resolveObserved;
  const observed = new Promise((resolve) => {
    resolveObserved = resolve;
  });
  const subscription = await realtime.subscribe(
    Channel.tablesdb(databaseId).table(tableIds.progress).row(),
    (message) => {
      if (message.payload?.$id === rowId) resolveObserved();
    },
  );
  await sleep(350);
  await tables.createRow({
    databaseId,
    tableId: tableIds.progress,
    rowId,
    data: {
      question_id: "question-progress",
      sequence: 200 + reconnectSequence,
      label: "reconnect",
    },
    permissions: actorPermissions,
  });
  await Promise.race([
    observed,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`reconnect timeout ${rowId}`)),
      10_000,
    )),
  ]);
  subscription.unsubscribe();
  realtime.disconnect();
  await tables.deleteRow({
    databaseId,
    tableId: tableIds.progress,
    rowId,
  });
}

async function buildPath() {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: workRoot,
    encoding: "utf8",
    stdio: "ignore",
  });
  if (result.status !== 0) throw new Error(`build exited ${result.status}`);
}

const operations = {
  representativeRead: readPath,
  representativeWrite: writePath,
  realtimeDelivery: realtimePath,
  reconnect: reconnectPath,
  build: buildPath,
};
for (const [name, operation] of Object.entries(operations)) {
  for (let index = 0; index < 2; index += 1) {
    warmups[name].push(await timed(operation));
  }
  for (let index = 0; index < 7; index += 1) {
    samples[name].push(await timed(operation));
  }
}
deliverySubscription.unsubscribe();
deliveryRealtime.disconnect();

const dockerIds = spawnSync("docker", [
  "ps",
  "-q",
  "--filter",
  "label=com.docker.compose.project=llp0102-research-appwrite-w1",
], { encoding: "utf8" }).stdout.trim().split(/\s+/).filter(Boolean);
const dockerStats = dockerIds.length
  ? spawnSync("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}",
      ...dockerIds,
    ], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, memory, cpu] = line.split("\t");
      return { name, memory, cpu };
    })
  : [];

const receiptValue = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  warmupsMs: warmups,
  recorded: Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [name, summarize(values)]),
  ),
  workload: {
    representativeRead: "authorized full-text search returning two rows",
    representativeWrite: "native-session question create then delete",
    realtimeDelivery: "authoritative progress-row create to Bob Realtime callback",
    reconnect: "fresh Bob Realtime client subscription through first authoritative callback",
    build: "TypeScript check plus Vite production build",
    warmupsPerPath: 2,
    recordedPerPath: 7,
    claimScope: "small repeatable product workload; not production scale",
  },
  machineContext: {
    composeContainerCount: dockerIds.length,
    allowlistedContainerStats: dockerStats,
  },
  containsSecretValues: false,
};
await mkdir(receiptsRoot, { recursive: true });
await writeFile(
  path.resolve(receiptsRoot, "performance.v1.json"),
  `${JSON.stringify(receiptValue, null, 2)}\n`,
);
console.log(JSON.stringify({
  ok: true,
  recorded: receiptValue.recorded,
  secretValuesPrinted: false,
}));
