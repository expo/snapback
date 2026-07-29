#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Query } from "node-appwrite";
import {
  databaseId,
  tableIds,
  tables,
  teamsApi,
  users,
} from "./admin-client.mjs";
import {
  appwriteVersion,
  armRoot,
  composeFile,
  endpoint,
  envFile,
  namespace,
  projectId,
  runtimeFile,
} from "./constants.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout.trim();
}
function labeled(kind) {
  const noun = kind === "container" ? "ps" : kind;
  const args = noun === "ps"
    ? ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${namespace}`]
    : [noun, "ls", "-q", "--filter", `label=com.docker.compose.project=${namespace}`];
  return run("docker", args).split(/\s+/).filter(Boolean);
}

const tableEntries = await Promise.all(
  Object.entries(tableIds).map(async ([name, id]) => {
    const [rows, indexes] = await Promise.all([
      tables.listRows({
        databaseId,
        tableId: id,
        queries: [Query.limit(1)],
        total: true,
      }),
      tables.listIndexes({
        databaseId,
        tableId: id,
        queries: [Query.limit(100)],
      }),
    ]);
    return [name, {
      rows: rows.total,
      indexes: indexes.indexes.map((index) => ({
        key: index.key,
        type: index.type,
        status: index.status,
        attributes: index.attributes,
      })),
    }];
  }),
);
const tableSummary = Object.fromEntries(tableEntries);
const [userList, teamList, versionResponse] = await Promise.all([
  users.list({ queries: [Query.limit(100)] }),
  teamsApi.list({ queries: [Query.limit(100)] }),
  fetch(`${endpoint}/health/version`).then(async (response) => {
    if (!response.ok) throw new Error(`health version failed: ${response.status}`);
    return response.json();
  }),
]);
const composeSha256 = hash(await readFile(composeFile));
const envSha256 = hash(await readFile(envFile));
const targetIdentity = {
  endpointHash: hash(endpoint),
  projectIdHash: hash(projectId),
  composeProject: namespace,
  productVersion: versionResponse.version,
  expectedProductVersion: appwriteVersion,
  webClientVersion: "26.2.0",
  nodeClientVersion: "27.1.0",
  cliVersion: "23.2.0",
  database: "MongoDB in official Appwrite Compose stack",
  deployment: "official Appwrite web-installer Docker Compose",
  composeSha256,
  envSha256,
};
const targetIdentityHash = hash(JSON.stringify(targetIdentity));
const containers = labeled("container");
const volumes = labeled("volume");
const networks = labeled("network");
const authoritative = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok:
    versionResponse.version === appwriteVersion &&
    userList.total === 3 &&
    teamList.total === 2 &&
    tableSummary.issues.rows === 500 &&
    tableSummary.issueLabels.rows === 1000 &&
    containers.length === 29 &&
    volumes.length === 12 &&
    networks.length === 2,
  targetIdentityHash,
  targetIdentity,
  authoritative: {
    userCount: userList.total,
    teamCount: teamList.total,
    tables: tableSummary,
    exactComposeResources: {
      containers: containers.length,
      volumes: volumes.length,
      networks: networks.length,
    },
  },
  containsSecretValues: false,
};
const baseline = JSON.parse(await readFile(path.resolve(armRoot, "receipts/baseline.v1.json")));
const cleanupPlan = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/cleanup-plan.v1.json")),
);
cleanupPlan.targetIdentityHash = targetIdentityHash;
cleanupPlan.targetMode = "fresh-local";
cleanupPlan.baselineWasEmpty =
  baseline.matchingContainers.length === 0 &&
  baseline.matchingVolumes.length === 0 &&
  baseline.matchingNetworks.length === 0;
cleanupPlan.steps = [
  "Stop only the listener on port 4324 after exact Vite PID and command validation.",
  "Remove only the exact installer container after llp0102.arm label validation.",
  "Run Docker Compose down -v for the exact generated files and exact Compose project.",
  "Remove only the three ignored arm-local runtime directories.",
  "Probe all assigned ports and exact Compose-label resources against the empty baseline.",
];
cleanupPlan.recovery =
  "Removed local data is not recoverable; retained bootstrap, schema, and deterministic provisioning source recreate it.";
cleanupPlan.containsSecretValues = false;
const runtimeStat = await stat(runtimeFile);
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetIdentityHash,
  runtimeBornAt: runtimeStat.birthtime.toISOString(),
  retainedEvidence: [
    "baseline.v1.json",
    "authoritative-summary.v1.json",
    "seed.v1.json",
    "acceptance-results.v1.json",
    "performance.v1.json",
    "dependency-audit.v1.json",
    "inventory.v1.json",
  ],
  dataExport: {
    status: "explicit-gap",
    reason:
      "No data export retained; the local target is disposable and the committed provisioning source deterministically recreates the frozen dataset.",
  },
  containsSecretValues: false,
};
for (const [name, value] of [
  ["authoritative-summary.v1.json", authoritative],
  ["cleanup-plan.v1.json", cleanupPlan],
  ["backup-manifest.v1.json", backup],
]) {
  await writeFile(
    path.resolve(armRoot, `receipts/${name}`),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}
process.stdout.write(`${JSON.stringify({ ok: authoritative.ok, targetIdentityHash, secretValuesPrinted: false })}\n`);
