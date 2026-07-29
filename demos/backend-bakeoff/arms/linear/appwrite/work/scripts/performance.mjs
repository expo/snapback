import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { Query } from "node-appwrite";
import {
  actorClient,
  databaseId,
  runtime,
  tableIds,
  tables,
} from "./admin-client.mjs";
import { receiptsRoot, vitePort, workRoot } from "./constants.mjs";

const warmups = 2;
const samples = 7;
const totalRuns = warmups + samples;
const round = (value) => Number(value.toFixed(3));
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values,
    median: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
async function timed(operation) {
  const started = performance.now();
  await operation();
  return round(performance.now() - started);
}
async function sample(operation) {
  const values = [];
  for (let index = 0; index < totalRuns; index += 1) {
    const duration = await timed(operation);
    if (index >= warmups) values.push(duration);
  }
  return stats(values);
}

const [alice, bob] = await Promise.all([actorClient("alice"), actorClient("bob")]);
const representativeRead = await sample(async () => {
  const result = await bob.tables.listRows({
    databaseId,
    tableId: tableIds.issues,
    queries: [
      Query.equal("org_id", ["org-primary"]),
      Query.equal("status", ["todo"]),
      Query.orderDesc("sequence"),
      Query.limit(50),
    ],
    total: false,
  });
  if (result.rows.length !== 50) throw new Error("Performance read shape changed");
});
const representativeDetail = await sample(async () => {
  const issue = await bob.tables.getRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-499",
  });
  const [project, member, comments, activities] = await Promise.all([
    bob.tables.getRow({ databaseId, tableId: tableIds.projects, rowId: issue.project_id }),
    bob.tables.getRow({ databaseId, tableId: tableIds.members, rowId: `member-${issue.assignee_id}` }),
    bob.tables.listRows({
      databaseId,
      tableId: tableIds.comments,
      queries: [Query.equal("issue_id", ["issue-499"]), Query.limit(50)],
      total: false,
    }),
    bob.tables.listRows({
      databaseId,
      tableId: tableIds.activities,
      queries: [Query.equal("issue_id", ["issue-499"]), Query.limit(50)],
      total: false,
    }),
  ]);
  if (!project.$id || !member.$id || comments.rows.length !== 2 || activities.rows.length !== 1) {
    throw new Error("Performance detail shape changed");
  }
});

const writeOriginal = await tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-499",
});
let writeOrdinal = 0;
const representativeWrite = await sample(async () => {
  writeOrdinal += 1;
  const title = `Performance update ${writeOrdinal}`;
  const updated = await alice.tables.updateRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-499",
    data: { title, search_text: title, revision: writeOrdinal + 1 },
  });
  if (updated.title !== title) throw new Error("Performance write did not settle");
});
await tables.updateRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-499",
  data: {
    title: writeOriginal.title,
    search_text: writeOriginal.search_text,
    revision: writeOriginal.revision,
  },
  permissions: writeOriginal.$permissions,
});

const browserRoot = path.resolve(workRoot, ".browser-runtime/performance");
await mkdir(browserRoot, { recursive: true });
const context = await chromium.launchPersistentContext(browserRoot, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = context.pages()[0] ?? await context.newPage();
let websocketCount = 0;
page.on("websocket", (socket) => {
  if (socket.url().includes("/v1/realtime")) websocketCount += 1;
});
await page.goto(`http://127.0.0.1:${vitePort}`);
await page.waitForTimeout(750);
if (!(await page.locator('.shell[data-ready="true"]').isVisible().catch(() => false))) {
  await page.getByLabel("Email").fill(runtime.personas.bob.email);
  await page.getByLabel("Password").fill(runtime.personas.bob.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
await page.locator('.shell[data-ready="true"][data-issue-count="50"]').waitFor({ timeout: 30_000 });

async function subscribe(marker) {
  await page.evaluate(async ({ marker }) => {
    const { Channel, databaseId, realtime } = await import("/src/appwrite.ts");
    await window.__performanceSubscription?.unsubscribe?.();
    window.__performanceEvents = [];
    window.__performanceSubscription = await realtime.subscribe(
      Channel.tablesdb(databaseId).table("issues").row("issue-498"),
      (event) => {
        window.__performanceEvents.push({
          marker: event.payload?.title,
          id: event.payload?.$id,
        });
      },
    );
    window.__performanceMarker = marker;
  }, { marker });
}
let realtimeOrdinal = 0;
const realtimeValues = [];
for (let index = 0; index < totalRuns; index += 1) {
  realtimeOrdinal += 1;
  const marker = `Realtime performance ${realtimeOrdinal}`;
  await subscribe(marker);
  const started = performance.now();
  await alice.tables.updateRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-498",
    data: { title: marker, search_text: marker, revision: realtimeOrdinal + 1 },
  });
  await page.waitForFunction((expected) =>
    (window.__performanceEvents ?? []).some((event) => event.marker === expected), marker);
  const duration = round(performance.now() - started);
  if (index >= warmups) realtimeValues.push(duration);
}
const realtimeDelivery = stats(realtimeValues);

const reconnectValues = [];
for (let index = 0; index < totalRuns; index += 1) {
  const marker = `Reconnect performance ${index + 1}`;
  await page.evaluate(async () => {
    const { realtime } = await import("/src/appwrite.ts");
    await realtime.disconnect();
  });
  const started = performance.now();
  await subscribe(marker);
  await alice.tables.updateRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-498",
    data: { title: marker, search_text: marker, revision: 20 + index },
  });
  await page.waitForFunction((expected) =>
    (window.__performanceEvents ?? []).some((event) => event.marker === expected), marker);
  const duration = round(performance.now() - started);
  if (index >= warmups) reconnectValues.push(duration);
}
const reconnect = stats(reconnectValues);
await tables.updateRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-498",
  data: {
    title: "Issue 498 deterministic search fixture",
    search_text: "Issue 498 deterministic search fixture Production-shaped Appwrite issue body 498",
    revision: 1,
  },
});
await context.close();

const buildValues = [];
for (let index = 0; index < totalRuns; index += 1) {
  const started = performance.now();
  const result = spawnSync("npm", ["run", "build", "--silent"], {
    cwd: workRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "Build sample failed");
  const duration = round(performance.now() - started);
  if (index >= warmups) buildValues.push(duration);
}
const buildOrDeploy = stats(buildValues);

const dockerStats = spawnSync("docker", [
  "stats", "--no-stream", "--format", "{{json .}}",
], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.Name === "exc1" || entry.Name.startsWith("appwrite"));
const performanceReceipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  claimScope: "isolated local Appwrite 1.9.6 self-host stack; not hosted or production latency",
  dataset: {
    organizations: 2,
    teams: 3,
    projects: 4,
    labels: 20,
    issues: 500,
    issueLabels: 1000,
    commentsAtMeasurement: 1001,
    pageSize: 50,
    concurrentClients: 2,
  },
  warmupsPerPath: warmups,
  recordedSamplesPerPath: samples,
  unit: "milliseconds",
  representativeRead,
  representativeDetail,
  representativeWrite,
  realtimeDelivery,
  reconnect,
  buildOrDeploy,
  realtimeWebSocketsObserved: websocketCount,
  productPolling: false,
  dockerResources: {
    containers: dockerStats.length,
    snapshots: dockerStats.map(({ Name, MemUsage, CPUPerc }) => ({ name: Name, memory: MemUsage, cpu: CPUPerc })),
  },
  machine: {
    model: "Mac17,3",
    architecture: "arm64",
    memory: "32 GiB host / 8 GiB Colima",
    dockerCpus: 4,
    os: "macOS 26.5.2 (25F84)",
    node: process.version,
  },
  costWindow: {
    measuredProviderCharge: "$0 self-hosted local",
    localCompute: "user-owned Colima VM",
    hostedActualUsage: "unavailable",
    hostedListPriceEstimate: "not estimated without a deployed target workload",
  },
};
await writeFile(
  path.resolve(receiptsRoot, "performance.v1.json"),
  `${JSON.stringify(performanceReceipt, null, 2)}\n`,
);
const scenarioPath = path.resolve(receiptsRoot, "scenarios/LINEAR-13-PERFORMANCE.json");
const scenario = {
  id: "LINEAR-13-PERFORMANCE",
  status: "pass",
  checkedAt: performanceReceipt.checkedAt,
  projectId: "llp0102-linear-appwrite-w2",
  transport: "push",
  evidence: performanceReceipt,
  note: "Two warmups and seven recorded samples are retained for indexed read, composed detail, write, native push, reconnect, and build.",
};
await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);
const acceptancePath = path.resolve(receiptsRoot, "acceptance-results.v1.json");
const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
acceptance.scenarios[scenario.id] = scenario;
acceptance.pendingExternalChecks = acceptance.pendingExternalChecks.filter((id) => id !== scenario.id);
acceptance.milestones.localAcceptanceMs = Date.now() - Date.parse(
  JSON.parse(await readFile(path.resolve(receiptsRoot, "baseline.v1.json"))).capturedAt,
);
acceptance.milestones.acceptanceCompletionMs = acceptance.milestones.localAcceptanceMs;
acceptance.finishedAt = performanceReceipt.checkedAt;
await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
console.log(JSON.stringify(performanceReceipt, null, 2));
