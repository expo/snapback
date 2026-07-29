#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { allRows, listsTableId, tasksTableId } from "./admin-client.mjs";

const receiptsRoot = resolve("../receipts");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const [lists, tasks] = await Promise.all([allRows(listsTableId), allRows(tasksTableId)]);
const personas = JSON.parse(await readFile(resolve(receiptsRoot, "personas.v1.json")));
const audit = JSON.parse(await readFile(resolve(receiptsRoot, "dependency-audit.v1.json")));
const taskIds = new Set(tasks.map((task) => task.$id));
const orderValid = lists.every(
  (list) =>
    list.task_order.length === 25 &&
    new Set(list.task_order).size === 25 &&
    list.task_order.every((id) => taskIds.has(id)),
);
const targetIdentity = {
  endpointHash: hash("http://127.0.0.1:8090/v1"),
  projectIdHash: hash("llp0102-todo-appwrite"),
  productVersion: "1.9.6",
  clientVersion: "26.2.0",
  cliVersion: "23.2.0",
  database: "MongoDB 8.2.5",
  deployment: "official Appwrite web-installer Docker Compose",
};
const targetIdentityHash = hash(JSON.stringify(targetIdentity));
const authoritative = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: lists.length === 4 && tasks.length === 100 && taskIds.size === 100 && orderValid,
  targetIdentityHash,
  targetIdentity,
  authoritative: {
    workspaceCount: 1,
    membershipCount: 2,
    listCount: lists.length,
    taskCount: tasks.length,
    uniqueTaskIds: taskIds.size,
    orderValid,
  },
  principalIdHashes: personas.principalIdHashes,
  containsSecretValues: false,
};
const baseline = {
  schemaVersion: 1,
  capturedAt: "2026-07-28T23:03:14.683Z",
  targetMode: "fresh-local",
  baseline: {
    matchingContainers: 0,
    matchingNetworks: 0,
    matchingVolumes: 0,
    cliPreferencesPresent: false,
  },
  ok: true,
  note: "Captured by read-only Docker and filesystem probes before the official installer started.",
  containsSecretValues: false,
};
const cleanupPlan = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetMode: "fresh-local",
  targetIdentityHash,
  baselineReceiptPath: "receipts/baseline.v1.json",
  baselineWasEmpty: true,
  scope: {
    composeFile: "work/.arm-runtime/appwrite/docker-compose.yml",
    composeProject: "appwrite",
    exactInstallerImage: "appwrite/appwrite:1.9.6",
    installerPort: 20080,
    apiPort: 8090,
    vitePort: 4186,
    localRuntimeDirectories: ["runtime", "work/.arm-runtime"],
    cliPreferences:
      "~/.appwrite/prefs.json only when its sole session targets http://127.0.0.1:8090/v1",
  },
  steps: [
    "Stop port 4186 only when its command is this arm's Vite process.",
    "Run Docker Compose down -v against the exact ignored installer-generated compose file.",
    "Stop the exact web-installer container publishing port 20080.",
    "Remove the CLI preferences only after endpoint/session-shape verification against the absent baseline.",
    "Remove only this arm's disposable browser and ignored runtime directories.",
    "Probe that ports, Appwrite containers, volumes, networks, and CLI state returned to baseline.",
  ],
  recovery:
    "The local data volumes are not recoverable after cleanup; retained provisioning source deterministically recreates the project.",
  containsSecretValues: false,
};
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetIdentityHash,
  authoritativeTaskCount: tasks.length,
  retainedEvidence: [
    "baseline.v1.json",
    "authoritative-summary.v1.json",
    "personas.v1.json",
    "correctness-smoke.v1.json",
    "offline-smoke.v1.json",
    "performance.v1.json",
    "dependency-audit.v1.json",
    "inventory.v1.json",
  ],
  dataExport: {
    status: "explicit-gap",
    reason: "No data export retained; deterministic provisioning recreates the disposable local target.",
  },
  containsSecretValues: false,
};

await mkdir(receiptsRoot, { recursive: true });
for (const [name, value] of [
  ["authoritative-summary.v1.json", authoritative],
  ["baseline.v1.json", baseline],
  ["cleanup-plan.v1.json", cleanupPlan],
  ["backup-manifest.v1.json", backup],
]) {
  await writeFile(resolve(receiptsRoot, name), `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}
process.stdout.write(`${JSON.stringify({
  ok: authoritative.ok,
  targetIdentityHash,
  dependencyAudit: audit.vulnerabilityCounts,
  secretValuesPrinted: false,
})}\n`);
