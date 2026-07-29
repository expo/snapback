#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  armRoot,
  assignedPorts,
  composeFile,
  envFile,
  installerName,
  namespace,
  receiptsRoot,
  workRoot,
} from "./constants.mjs";

if (
  path.basename(armRoot) !== "appwrite" ||
  path.basename(path.dirname(armRoot)) !== "linear" ||
  !workRoot.startsWith("/private/tmp/llp0102-linear-appwrite-w2/")
) {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}
const plan = JSON.parse(await readFile(path.resolve(receiptsRoot, "cleanup-plan.v1.json")));
if (
  !plan.baselineWasEmpty ||
  plan.namespace !== namespace ||
  plan.exactWorkRoot !== workRoot ||
  plan.exactComposeFile !== composeFile ||
  plan.exactEnvFile !== envFile
) throw new Error("refusing cleanup without exact frozen target plan");

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: workRoot, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || `${command} failed with ${result.status}`);
  }
  return result.stdout.trim();
}
function listener(port) {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const pids = result.stdout.trim().split(/\s+/).map(Number);
  return pids.map((pid) => ({
    pid,
    command: run("ps", ["-p", String(pid), "-o", "command="]),
  }));
}
function exactResources(kind) {
  if (kind === "container") {
    return run("docker", [
      "ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${namespace}`,
    ], { allowFailure: true }).split(/\s+/).filter(Boolean);
  }
  return run("docker", [
    kind, "ls", "-q", "--filter", `label=com.docker.compose.project=${namespace}`,
  ], { allowFailure: true }).split(/\s+/).filter(Boolean);
}

const viteListeners = listener(4324) ?? [];
const recordedVitePid = Number(
  (await readFile(path.resolve(receiptsRoot, "vite.pid"), "utf8")).trim(),
);
for (const item of viteListeners) {
  if (
    item.pid !== recordedVitePid ||
    !item.command.includes("vite") ||
    !item.command.includes("4324")
  ) throw new Error(`refusing to stop unbound port 4324 listener: ${JSON.stringify(item)}`);
  process.kill(item.pid, "SIGTERM");
}

const installerInspect = spawnSync("docker", [
  "inspect", "-f", "{{index .Config.Labels \"llp0102.arm\"}}", installerName,
], { encoding: "utf8" });
if (installerInspect.status === 0) {
  if (installerInspect.stdout.trim() !== namespace) {
    throw new Error("refusing to remove installer without exact arm label");
  }
  run("docker", ["rm", "-f", installerName]);
}

await access(composeFile);
await access(envFile);
run("docker", [
  "compose",
  "--env-file", envFile,
  "-f", composeFile,
  "--project-name", namespace,
  "--project-directory", path.dirname(composeFile),
  "down", "-v", "--remove-orphans",
]);

for (const runtimePath of plan.exactRuntimePaths) {
  if (!runtimePath.startsWith(`${workRoot}/`)) {
    throw new Error(`refusing out-of-arm runtime removal: ${runtimePath}`);
  }
  await rm(runtimePath, { recursive: true, force: true });
}
await new Promise((resolve) => setTimeout(resolve, 1000));
const probes = Object.fromEntries(
  assignedPorts.map((port) => [`port${port}Closed`, listener(port) === null]),
);
probes.matchingContainersRestored = exactResources("container").length === 0;
probes.matchingVolumesRestored = exactResources("volume").length === 0;
probes.matchingNetworksRestored = exactResources("network").length === 0;
for (const runtimePath of plan.exactRuntimePaths) {
  try {
    await access(runtimePath);
    probes[`absent:${path.basename(runtimePath)}`] = false;
  } catch {
    probes[`absent:${path.basename(runtimePath)}`] = true;
  }
}
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: Object.values(probes).every(Boolean),
  targetIdentityHash: plan.targetIdentityHash,
  baselineReceiptPath: "receipts/baseline.v1.json",
  removed: [
    `exact Compose project ${namespace}, its labeled containers, twelve named volumes, and two networks`,
    `exact arm-labeled installer ${installerName}`,
    "exact recorded Vite process and three ignored arm-local runtime directories",
  ],
  retained: [
    "Docker images, npm dependencies, source, and receipts",
    "all resources without the exact arm identity",
  ],
  probes,
  recovery:
    "Removed local Appwrite data is not recoverable; retained installer/bootstrap/provisioning source recreates it.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(receiptsRoot, "cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok) process.exit(1);
