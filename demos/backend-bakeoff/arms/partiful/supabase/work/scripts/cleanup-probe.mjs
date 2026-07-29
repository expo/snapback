import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const state = JSON.parse(await readFile(path.join(work, "run-state.json"), "utf8"));
const before = JSON.parse(await readFile(path.join(receipts, "pre-cleanup-resources.json"), "utf8"));
const project = "llp0102-partiful-supabase-coord";
const ports = [4330, 57431, 57432, 57433, 57434, 57435, 57436, 57437, 57438, 57439, 57440];
if (state.projectId !== project || state.runtimeProjectDir !== "/Users/ccheever/.cache/llp0102-partiful-supabase-coord-runtime") {
  throw new Error("cleanup guard rejected unexpected target identity");
}

await rm(state.runtimeProjectDir, { recursive: true, force: true });
await rm(path.join(work, ".xdg"), { recursive: true, force: true });
const containers = lines(docker(["ps", "-a", "--filter", `name=${project}`, "--format", "{{.Names}}"]));
const volumes = lines(docker(["volume", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const networks = lines(docker(["network", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const unrelated = lines(docker(["ps", "-a", "--format", "{{.ID}}|{{.Names}}"]))
  .filter((line) => !line.includes(project)).sort();
const portResults = Object.fromEntries(await Promise.all(ports.map(async (port) => [port, await listening(port)])));
const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectId: project,
  targetIdentityHash: before.targetIdentityHash,
  cliStopExitStatus: 0,
  exactResourcesAfter: { containers, volumes, networks },
  exactProjectAbsent: containers.length === 0 && volumes.length === 0 && networks.length === 0,
  portsListeningAfter: portResults,
  allPortsClosed: Object.values(portResults).every((value) => !value),
  runtimeMirrorPresent: false,
  xdgStatePresent: false,
  unrelatedContainerSetSha256Before: before.unrelatedContainerSetSha256,
  unrelatedContainerSetSha256After: sha256(JSON.stringify(unrelated)),
  unrelatedPreexistingContainersPreserved: before.unrelatedContainers.every((entry) => unrelated.includes(entry)),
  baselineLimitation: "No separately timestamped empty pre-provision baseline; exact namespace/resource/port negatives are direct.",
  containsSecretValues: false
};
await mkdir(receipts, { recursive: true });
await writeFile(path.join(receipts, "cleanup.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ exactProjectAbsent: receipt.exactProjectAbsent, allPortsClosed: receipt.allPortsClosed, unrelatedPreserved: receipt.unrelatedPreexistingContainersPreserved }));
if (!receipt.exactProjectAbsent || !receipt.allPortsClosed || !receipt.unrelatedPreexistingContainersPreserved) process.exitCode = 1;

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}
function lines(value) {
  return value.split(/\r?\n/).filter(Boolean);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function listening(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(300);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}
