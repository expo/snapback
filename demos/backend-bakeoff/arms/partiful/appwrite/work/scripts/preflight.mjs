import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  armBaseCommit,
  assignedPorts,
  composeFile,
  envFile,
  freezeAggregateSha256,
  frozenSnapbackCommit,
  namespace,
  receiptsRoot,
  runtimeRoot,
  workRoot,
} from "./constants.mjs";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

async function listening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

const startedAt = new Date().toISOString();
await mkdir(receiptsRoot, { recursive: true });
const sourceHead = run("git", ["rev-parse", "HEAD"]);
const dockerCapacity = JSON.parse(run("docker", [
  "info", "--format", "{\"cpus\":{{.NCPU}},\"memoryBytes\":{{.MemTotal}}}",
]));
if (sourceHead !== armBaseCommit) {
  throw new Error(`arm base drift: expected ${armBaseCommit}, received ${sourceHead}`);
}
if (dockerCapacity.cpus < 2 || dockerCapacity.memoryBytes < 4 * 1024 ** 3) {
  throw new Error(`Appwrite minimum Docker capacity missing: ${JSON.stringify(dockerCapacity)}`);
}
const ports = Object.fromEntries(await Promise.all(
  assignedPorts.map(async (port) => [port, (await listening(port)) ? "open" : "closed"]),
));
const containers = run("docker", [
  "ps", "-a", "--filter", `label=com.docker.compose.project=${namespace}`,
  "--format", "{{.ID}} {{.Names}}",
]).split("\n").filter(Boolean);
const volumes = run("docker", [
  "volume", "ls", "--filter", `label=com.docker.compose.project=${namespace}`,
  "--format", "{{.Name}}",
]).split("\n").filter(Boolean);
const networks = run("docker", [
  "network", "ls", "--filter", `label=com.docker.compose.project=${namespace}`,
  "--format", "{{.Name}}",
]).split("\n").filter(Boolean);
const unrelatedContainers = run("docker", [
  "ps",
  "--format", "{{.ID}} {{.Names}} {{.Ports}} {{.Labels}}",
]).split("\n").filter((line) =>
  line && !line.includes(`com.docker.compose.project=${namespace}`));
const baseline = {
  schemaVersion: 1,
  capturedAt: startedAt,
  exactWorkRoot: workRoot,
  namespace,
  sourceBaseCommit: armBaseCommit,
  observedSourceCommit: sourceHead,
  frozenSnapbackCommit,
  freezeAggregateSha256,
  dockerContext: run("docker", ["context", "show"]),
  dockerCapacity,
  ports,
  matchingContainers: containers,
  matchingVolumes: volumes,
  matchingNetworks: networks,
  unrelatedContainerHashes: unrelatedContainers.map((line) =>
    createHash("sha256").update(line).digest("hex")),
  composePaths: { composeFile, envFile },
  runtimeRoot,
  status: "empty",
};
if (
  Object.values(ports).some((state) => state !== "closed") ||
  containers.length ||
  volumes.length ||
  networks.length
) {
  throw new Error(`Appwrite arm baseline is not empty: ${JSON.stringify(baseline)}`);
}
await writeFile(
  path.resolve(receiptsRoot, "baseline.v1.json"),
  `${JSON.stringify(baseline, null, 2)}\n`,
);
await writeFile(
  path.resolve(receiptsRoot, "cleanup-plan.v1.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    createdAt: startedAt,
    exactWorkRoot: workRoot,
    namespace,
    baselineReceipt: "receipts/baseline.v1.json",
    exactComposeFile: composeFile,
    exactEnvFile: envFile,
    exactPorts: assignedPorts,
    exactRuntimePaths: [
      runtimeRoot,
      path.resolve(workRoot, ".cli-home"),
      path.resolve(workRoot, ".browser-runtime"),
    ],
    guard: "Only resources carrying the exact Compose project label or exact installer name may be removed.",
    unrelatedContainerAction: "preserve; never address by cleanup command",
  }, null, 2)}\n`,
);
console.log(JSON.stringify(baseline, null, 2));
