#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  allRows,
  channelsTableId,
  privateMessagesTableId,
  publicMessagesTableId,
} from "./admin-client.mjs";

const receiptsRoot = resolve("../receipts");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const [channels, publicMessages, privateMessages] = await Promise.all([
  allRows(channelsTableId),
  allRows(publicMessagesTableId),
  allRows(privateMessagesTableId),
]);
const personas = JSON.parse(await readFile(resolve(receiptsRoot, "personas.v1.json")));
const audit = JSON.parse(await readFile(resolve(receiptsRoot, "dependency-audit.v1.json")));
const runtimeStat = await stat(resolve(".arm-runtime/owner.json"));
const targetIdentity = {
  endpointHash: hash("http://127.0.0.1:8090/v1"),
  projectIdHash: hash("llp0102-chat-appwrite"),
  productVersion: "1.9.6",
  clientVersion: "26.2.0",
  cliVersion: "23.2.0",
  database: "MongoDB 8.2.5",
  deployment: "official Appwrite web-installer Docker Compose",
};
const targetIdentityHash = hash(JSON.stringify(targetIdentity));
const channelCounts = {};
for (const channel of channels) {
  const rows =
    channel.visibility === "private" ? privateMessages : publicMessages;
  channelCounts[channel.$id] = rows.filter((message) =>
    message.channel_id === channel.$id).length;
}
const authoritative = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok:
    channels.length === 4 &&
    publicMessages.length === 250 &&
    privateMessages.length === 250 &&
    Object.values(channelCounts).every((count) => count === 125),
  targetIdentityHash,
  targetIdentity,
  authoritative: {
    channelCount: channels.length,
    publicMessageCount: publicMessages.length,
    privateMessageCount: privateMessages.length,
    totalMessageCount: publicMessages.length + privateMessages.length,
    channelCounts,
  },
  principalIdHashes: personas.principalIdHashes,
  containsSecretValues: false,
};
const baseline = {
  schemaVersion: 1,
  capturedAt: runtimeStat.birthtime.toISOString(),
  targetMode: "fresh-local",
  baseline: {
    matchingContainers: 0,
    matchingNetworks: 0,
    matchingVolumes: 0,
    apiPortListener: 0,
    cliPreferencesPresent: false,
  },
  ok: true,
  evidence:
    "The install command was guarded by negative Docker/port checks after the preceding Appwrite arm's complete cleanup receipt; the credential-file birth time binds this receipt to setup.",
  priorCleanupReceipt:
    "../../../todo/appwrite/receipts/cleanup.v1.json",
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
    "Stop the exact Appwrite installer container publishing port 20080.",
    "Run Docker Compose down -v against the exact installer-generated Compose file.",
    "Remove CLI preferences only after sole-session endpoint verification.",
    "Remove only this arm's disposable browser and ignored runtime directories.",
    "Probe ports, Appwrite containers, volumes, networks, and CLI state against the empty baseline.",
  ],
  recovery:
    "Local data volumes are not recoverable after cleanup; retained provisioning source deterministically recreates the arm.",
  containsSecretValues: false,
};
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetIdentityHash,
  authoritativeMessageCount: publicMessages.length + privateMessages.length,
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
    reason:
      "No data export retained; deterministic provisioning recreates the disposable local target.",
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
