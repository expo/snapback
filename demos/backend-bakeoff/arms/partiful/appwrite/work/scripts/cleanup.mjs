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
  runtimeFile,
  workRoot,
} from "./constants.mjs";

if (
  path.basename(armRoot) !== "appwrite" ||
  path.basename(path.dirname(armRoot)) !== "partiful" ||
  !workRoot.startsWith("/private/tmp/llp0102-partiful-appwrite-w3/")
) throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
const [plan, runtime] = await Promise.all([
  readFile(path.resolve(receiptsRoot, "cleanup-plan.v1.json")).then(JSON.parse),
  readFile(runtimeFile).then(JSON.parse),
]);
if (
  !plan.baselineWasEmpty || plan.namespace !== namespace ||
  plan.exactWorkRoot !== workRoot || plan.exactComposeFile !== composeFile ||
  plan.exactEnvFile !== envFile || plan.effectSinkContainer !== runtime.effectSinkContainer
) throw new Error("refusing cleanup without exact frozen target plan");

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: workRoot, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || `${command} failed with ${result.status}`);
  return result.stdout.trim();
}
function listener(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split(/\s+/).map(Number).map((pid) => ({
    pid,
    command: run("ps", ["-p", String(pid), "-o", "command="]),
  }));
}
function exactResources(kind) {
  const args = kind === "container"
    ? ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${namespace}`]
    : [kind, "ls", "-q", "--filter", `label=com.docker.compose.project=${namespace}`];
  return run("docker", args, { allowFailure: true }).split(/\s+/).filter(Boolean);
}

const viteListeners = listener(4334);
let recordedVitePid = null;
try { recordedVitePid = Number((await readFile(path.resolve(receiptsRoot, "vite.pid"), "utf8")).trim()); } catch {}
for (const item of viteListeners) {
  if (item.pid !== recordedVitePid || !item.command.includes("vite") || !item.command.includes("4334")) {
    throw new Error(`refusing to stop unbound port 4334 listener: ${JSON.stringify(item)}`);
  }
  process.kill(item.pid, "SIGTERM");
}

const effect = JSON.parse(run("docker", ["inspect", runtime.effectSinkContainer]))[0];
const hostPort = effect.HostConfig.PortBindings?.["20082/tcp"]?.[0]?.HostPort;
if (
  effect.Name !== `/${runtime.effectSinkContainer}` ||
  effect.Config.Image !== "openruntimes/node:v5-22" ||
  hostPort !== "20082"
) throw new Error("refusing to remove effect sink without exact recorded identity");
run("docker", ["rm", "-f", runtime.effectSinkContainer]);

const installerInspect = spawnSync("docker", [
  "inspect", "-f", "{{index .Config.Labels \"llp0102.arm\"}}", installerName,
], { encoding: "utf8" });
if (installerInspect.status === 0) {
  if (installerInspect.stdout.trim() !== namespace) throw new Error("refusing to remove installer without exact arm label");
  run("docker", ["rm", "-f", installerName]);
}

await access(composeFile);
await access(envFile);
run("docker", [
  "compose", "--env-file", envFile, "-f", composeFile,
  "--project-name", namespace, "--project-directory", path.dirname(composeFile),
  "down", "-v", "--remove-orphans",
]);
const runtimeContainers = run("docker", [
  "ps", "-a", "--format", "{{.Names}}", "--filter", "label=utopia-type=runtime",
], { allowFailure: true }).split(/\s+/).filter((name) =>
  name.startsWith(`exc1-${namespace}-`));
for (const name of runtimeContainers) {
  const inspected = JSON.parse(run("docker", ["inspect", name]))[0];
  if (
    inspected.Config.Labels?.["openruntimes-runtime-id"] !== name.slice("exc1-".length) ||
    inspected.Config.Labels?.["utopia-type"] !== "runtime" ||
    inspected.Config.Image !== "openruntimes/node:v5-22"
  ) throw new Error(`refusing unbound Open Runtimes cleanup: ${name}`);
  run("docker", ["rm", "-f", name]);
}
for (const runtimePath of plan.exactRuntimePaths) {
  if (!runtimePath.startsWith(`${workRoot}/`)) throw new Error(`refusing out-of-arm runtime removal: ${runtimePath}`);
  await rm(runtimePath, { recursive: true, force: true });
}
await new Promise((resolve) => setTimeout(resolve, 1000));
const probes = Object.fromEntries(assignedPorts.map((port) => [`port${port}Closed`, listener(port).length === 0]));
probes.matchingContainersRestored = exactResources("container").length === 0;
probes.matchingVolumesRestored = exactResources("volume").length === 0;
probes.matchingNetworksRestored = exactResources("network").length === 0;
probes.openRuntimesContainersAbsent = run("docker", [
  "ps", "-a", "-q", "--filter", "label=utopia-type=runtime",
], { allowFailure: true }).split(/\s+/).filter(Boolean).every((id) => {
  const name = run("docker", ["inspect", "-f", "{{.Name}}", id]);
  return !name.includes(namespace);
});
probes.effectSinkAbsent = spawnSync("docker", ["inspect", runtime.effectSinkContainer], { encoding: "utf8" }).status !== 0;
for (const runtimePath of plan.exactRuntimePaths) {
  try { await access(runtimePath); probes[`absent:${path.basename(runtimePath)}`] = false; }
  catch { probes[`absent:${path.basename(runtimePath)}`] = true; }
}
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: Object.values(probes).every(Boolean),
  targetIdentityHash: plan.targetIdentityHash,
  baselineReceiptPath: "receipts/baseline.v1.json",
  removed: [
    `exact Compose project ${namespace} and its labeled containers, volumes, and networks`,
    `exact recorded effect sink ${runtime.effectSinkContainer}`,
    `exact arm-labeled installer ${installerName} if present`,
    "exact recorded Vite process and three ignored arm-local runtime directories",
  ],
  retained: ["Docker images, npm dependencies, source, receipts, and every resource without an exact arm identity"],
  probes,
  recovery: "Removed local Appwrite data is not recoverable; retained installer/bootstrap/provisioning/function source recreates it.",
  unrelatedBaselineAction: "none",
  containsSecretValues: false,
};
await writeFile(path.resolve(receiptsRoot, "cleanup.v1.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(receipt));
if (!receipt.ok) process.exit(1);
