#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
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
  path.basename(armRoot) !== "appwrite"
  || path.basename(path.dirname(armRoot)) !== "research-room"
  || workRoot !== "/private/tmp/llp0102-research-appwrite-w1/demos/backend-bakeoff/arms/research-room/appwrite/work"
) {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}
const plan = JSON.parse(await readFile(
  path.resolve(receiptsRoot, "cleanup-plan.v1.json"),
  "utf8",
));
if (
  !plan.baselineWasEmpty
  || plan.namespace !== namespace
  || plan.exactWorkRoot !== workRoot
  || plan.exactComposeFile !== composeFile
  || plan.exactEnvFile !== envFile
) {
  throw new Error("refusing cleanup without exact frozen target plan");
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: workRoot,
    encoding: "utf8",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function listening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const recordedVitePid = Number((await readFile(
  path.resolve(receiptsRoot, "vite.pid"),
  "utf8",
)).trim());
const viteListeners = run("lsof", [
  "-nP",
  "-iTCP:4346",
  "-sTCP:LISTEN",
  "-t",
], { allowFailure: true }).stdout.split(/\s+/).filter(Boolean).map(Number);
if (
  viteListeners.length !== 1
  || viteListeners[0] !== recordedVitePid
) {
  throw new Error("refusing to stop Vite without exact recorded PID and port ownership");
}
const viteExecutable = run("ps", [
  "-p",
  String(recordedVitePid),
  "-o",
  "comm=",
]).stdout;
if (path.basename(viteExecutable) !== "node") {
  throw new Error("refusing to stop Vite without allowlisted node executable");
}
process.kill(recordedVitePid, "SIGTERM");

const installerIds = run("docker", [
  "ps",
  "-a",
  "-q",
  "--filter",
  `name=^/${installerName}$`,
  "--filter",
  `label=llp0102.arm=${namespace}`,
], { allowFailure: true }).stdout.split(/\s+/).filter(Boolean);
if (installerIds.length > 1) {
  throw new Error("refusing unexpected installer multiplicity");
}
if (installerIds.length === 1) {
  run("docker", ["rm", "-f", installerIds[0]]);
}

await access(composeFile);
await access(envFile);
const composeResult = run("docker", [
  "compose",
  "--env-file",
  envFile,
  "-f",
  composeFile,
  "--project-name",
  namespace,
  "--project-directory",
  path.dirname(composeFile),
  "down",
  "-v",
  "--remove-orphans",
]);
const composeLog = `${composeResult.stdout}\n${composeResult.stderr}`;
const composeLogHash = createHash("sha256").update(composeLog).digest("hex");

const runtimeNames = run("docker", [
  "ps",
  "-a",
  "--filter",
  "label=utopia-type=runtime",
  "--format",
  "{{.Names}}",
], { allowFailure: true }).stdout.split(/\s+/).filter((name) => name.includes(namespace));
for (const name of runtimeNames) {
  if (!name.startsWith(`exc1-${namespace}-`)) {
    throw new Error(`refusing unexpected runtime name: ${name}`);
  }
  run("docker", ["rm", "-f", name]);
}

const trashRoot = `/Users/ccheever/.Trash/llp0102-research-appwrite-w1-${new Date()
  .toISOString().replaceAll(/[-:.]/g, "").replace("Z", "Z")}`;
await mkdir(trashRoot, { recursive: true });
const movedPaths = [];
for (const runtimePath of plan.exactRuntimePaths) {
  if (!runtimePath.startsWith(`${workRoot}/`)) {
    throw new Error(`refusing out-of-arm runtime move: ${runtimePath}`);
  }
  try {
    await access(runtimePath);
  } catch {
    continue;
  }
  const destination = path.resolve(trashRoot, path.basename(runtimePath));
  await rename(runtimePath, destination);
  movedPaths.push(path.basename(runtimePath));
}

await new Promise((resolve) => setTimeout(resolve, 1000));
const exactContainerCount = run("docker", [
  "ps",
  "-a",
  "-q",
  "--filter",
  `label=com.docker.compose.project=${namespace}`,
], { allowFailure: true }).stdout.split(/\s+/).filter(Boolean).length;
const exactVolumeCount = run("docker", [
  "volume",
  "ls",
  "-q",
  "--filter",
  `label=com.docker.compose.project=${namespace}`,
], { allowFailure: true }).stdout.split(/\s+/).filter(Boolean).length;
const exactNetworkCount = run("docker", [
  "network",
  "ls",
  "-q",
  "--filter",
  `label=com.docker.compose.project=${namespace}`,
], { allowFailure: true }).stdout.split(/\s+/).filter(Boolean).length;
const ports = Object.fromEntries(await Promise.all(
  assignedPorts.map(async (port) => [`port${port}Closed`, !await listening(port)]),
));
const runtimePathsAbsent = {};
for (const runtimePath of plan.exactRuntimePaths) {
  try {
    await access(runtimePath);
    runtimePathsAbsent[path.basename(runtimePath)] = false;
  } catch {
    runtimePathsAbsent[path.basename(runtimePath)] = true;
  }
}
const probes = {
  ...ports,
  exactComposeContainersAbsent: exactContainerCount === 0,
  exactComposeVolumesAbsent: exactVolumeCount === 0,
  exactComposeNetworksAbsent: exactNetworkCount === 0,
  exactInstallerAbsent: run("docker", [
    "ps",
    "-a",
    "-q",
    "--filter",
    `name=^/${installerName}$`,
  ], { allowFailure: true }).stdout === "",
  exactRuntimeContainersAbsent: run("docker", [
    "ps",
    "-a",
    "--filter",
    "label=utopia-type=runtime",
    "--format",
    "{{.Names}}",
  ], { allowFailure: true }).stdout.split(/\s+/).filter(Boolean)
    .every((name) => !name.includes(namespace)),
  runtimePathsAbsent,
};
const ok = [
  ...Object.values(ports),
  probes.exactComposeContainersAbsent,
  probes.exactComposeVolumesAbsent,
  probes.exactComposeNetworksAbsent,
  probes.exactInstallerAbsent,
  probes.exactRuntimeContainersAbsent,
  ...Object.values(runtimePathsAbsent),
].every(Boolean);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok,
  targetIdentityHash: "c3fe43b8f6ae4fb0e68401b00b096f5860919037bb81e95093fc99729e1ef337",
  baselineReceiptPath: "receipts/baseline.v1.json",
  removed: [
    `exact Compose project ${namespace} and its labeled containers, volumes, and networks`,
    `exact arm-labeled installer ${installerName} if present`,
    "exact namespace-matching Open Runtimes containers",
    "recorded Vite process after PID, executable, and port proof",
  ],
  recoverablyMoved: {
    trashRoot,
    pathBasenames: movedPaths,
  },
  retained: [
    "Docker images",
    "source, lockfile, receipts, and every resource without the exact arm identity",
  ],
  composeCommand: {
    exitStatus: composeResult.status,
    outputSha256: composeLogHash,
    rawOutputRetained: false,
  },
  probes,
  recovery: "Local Appwrite database volumes are not recoverable; source recreates them. Arm-local CLI, browser, dependency, build, and runtime paths were moved to Trash.",
  unrelatedBaselineAction: "none",
  evidenceHandling: "allowlisted PID, executable basename, resource counts/names/labels, ports, and output hashes only",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(receiptsRoot, "cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify({
  ok,
  exactComposeContainers: exactContainerCount,
  exactComposeVolumes: exactVolumeCount,
  exactComposeNetworks: exactNetworkCount,
  ports,
  movedPathCount: movedPaths.length,
  composeOutputSha256: composeLogHash,
  secretValuesPrinted: false,
}));
if (!ok) process.exit(1);
