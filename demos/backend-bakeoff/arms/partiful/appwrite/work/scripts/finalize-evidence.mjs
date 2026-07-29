#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Query } from "node-appwrite";
import {
  databaseId,
  functionId,
  functions,
  runtime,
  storage,
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
  receiptsRoot,
  runtimeFile,
} from "./constants.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const run = (command, args, allowFailure = false) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout.trim();
};
const labeled = (kind) => {
  const args = kind === "container"
    ? ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${namespace}`]
    : [kind, "ls", "-q", "--filter", `label=com.docker.compose.project=${namespace}`];
  return run("docker", args).split(/\s+/).filter(Boolean);
};
const tableSummary = {};
for (const [name, tableId] of Object.entries(tableIds)) {
  const [rowList, indexList, table] = await Promise.all([
    tables.listRows({ databaseId, tableId, queries: [Query.limit(1)], total: true }),
    tables.listIndexes({ databaseId, tableId, queries: [Query.limit(100)] }),
    tables.getTable({ databaseId, tableId }),
  ]);
  tableSummary[name] = {
    rows: rowList.total,
    permissions: table.$permissions,
    rowSecurity: table.rowSecurity,
    indexes: indexList.indexes.map((index) => ({
      key: index.key, type: index.type, status: index.status, attributes: index.attributes,
    })),
  };
}
const [userList, teamList, bucketList, functionList, executionList, versionResponse] = await Promise.all([
  users.list({ queries: [Query.limit(100)], total: true }),
  teamsApi.list({ queries: [Query.limit(100)], total: true }),
  storage.listBuckets({ queries: [Query.limit(100)], total: true }),
  functions.list({ queries: [Query.limit(100)], total: true }),
  functions.listExecutions({ functionId, queries: [Query.limit(100)], total: true }),
  fetch(`${endpoint}/health/version`).then((response) => response.json()),
]);
const functionModel = await functions.get({ functionId });
const deployments = await functions.listDeployments({ functionId, queries: [Query.limit(100)], total: true });
const variables = await functions.listVariables({ functionId, queries: [Query.limit(100)], total: true });
const files = await storage.listFiles({ bucketId: "event-art", queries: [Query.limit(100)], total: true });
const targetIdentity = {
  endpointHash: hash(endpoint),
  projectIdHash: hash(projectId),
  composeProject: namespace,
  productVersion: versionResponse.version,
  expectedProductVersion: appwriteVersion,
  providerClients: { web: "26.2.0", node: "27.1.0", cli: "23.2.0" },
  composeSha256: hash(await readFile(composeFile)),
  envSha256: hash(await readFile(envFile)),
};
const targetIdentityHash = hash(JSON.stringify(targetIdentity));
const containers = labeled("container");
const volumes = labeled("volume");
const networks = labeled("network");
const effectInspect = JSON.parse(run("docker", ["inspect", runtime.effectSinkContainer]))[0];
const authoritative = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok:
    versionResponse.version === appwriteVersion &&
    userList.total === 3 && teamList.total === 1 &&
    tableSummary.events.rows === 20 && tableSummary.guests.rows === 49 &&
    bucketList.total === 1 && files.total === 0 &&
    functionList.total === 1 && deployments.total >= 1 &&
    containers.length > 0 && volumes.length > 0 && networks.length > 0 &&
    effectInspect.Name === `/${runtime.effectSinkContainer}`,
  targetIdentityHash,
  targetIdentity,
  authoritative: {
    userCount: userList.total,
    teamCount: teamList.total,
    tables: tableSummary,
    storage: { buckets: bucketList.total, remainingFiles: files.total },
    function: {
      id: functionModel.$id,
      runtime: functionModel.runtime,
      schedule: functionModel.schedule,
      deployments: deployments.total,
      executions: executionList.total,
      variableKeys: variables.variables.map((variable) => ({ key: variable.key, secret: variable.secret })),
      secretValuesPresent: false,
    },
    exactComposeResources: { containers: containers.length, volumes: volumes.length, networks: networks.length },
    effectSink: { name: runtime.effectSinkContainer, image: effectInspect.Config.Image, secretValuesPresent: false },
  },
  containsSecretValues: false,
};
const baseline = JSON.parse(await readFile(path.resolve(receiptsRoot, "baseline.v1.json")));
const cleanupPlan = JSON.parse(await readFile(path.resolve(receiptsRoot, "cleanup-plan.v1.json")));
cleanupPlan.targetIdentityHash = targetIdentityHash;
cleanupPlan.targetMode = "fresh-local";
cleanupPlan.baselineWasEmpty =
  baseline.matchingContainers.length === 0 &&
  baseline.matchingVolumes.length === 0 &&
  baseline.matchingNetworks.length === 0;
cleanupPlan.effectSinkContainer = runtime.effectSinkContainer;
cleanupPlan.steps = [
  "Stop only the exact recorded Vite PID after command/port validation.",
  "Remove only the exact recorded effect-sink container after name, image, port, and runtime-record validation.",
  "Remove only an exact arm-labeled installer if one still exists.",
  "Run Docker Compose down -v for the exact generated files and exact Compose project.",
  "Remove only the three ignored arm-local runtime directories.",
  "Probe all assigned ports and exact Compose-label resources against the empty baseline.",
];
cleanupPlan.recovery = "Removed local Appwrite data is not recoverable; retained bootstrap, schema, function, and deterministic provisioning source recreate it.";
cleanupPlan.containsSecretValues = false;
const runtimeStat = await stat(runtimeFile);
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetIdentityHash,
  runtimeBornAt: runtimeStat.birthtime.toISOString(),
  retainedEvidence: [
    "baseline.v1.json", "authoritative-summary.v1.json", "seed.v1.json",
    "acceptance-results.v1.json", "performance.v1.json", "dependency-audit.v1.json", "inventory.v1.json",
  ],
  dataExport: {
    status: "explicit-gap",
    reason: "No data export retained; this fresh local target is disposable and committed provisioning source deterministically recreates it.",
  },
  containsSecretValues: false,
};
for (const [name, value] of [
  ["authoritative-summary.v1.json", authoritative],
  ["cleanup-plan.v1.json", cleanupPlan],
  ["backup-manifest.v1.json", backup],
]) {
  await writeFile(path.resolve(receiptsRoot, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
console.log(JSON.stringify({ ok: authoritative.ok, targetIdentityHash, secretValuesPrinted: false }));
if (!authoritative.ok) process.exit(1);
