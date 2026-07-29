import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const state = JSON.parse(await readFile(path.join(work, "run-state.json"), "utf8"));
const project = "llp0102-linear-supabase-w3";
const ports = [4322, 56431, 56432, 56433, 56434, 56435, 56436, 56437, 56438, 56439, 56440];

if (state.projectId !== project || state.runtimeProjectDir !== "/Users/ccheever/.cache/llp0102-linear-supabase-w3-runtime") {
  throw new Error("cleanup guard refused unexpected target identity");
}

await rm(state.runtimeProjectDir, { recursive: true, force: true });
await rm(path.join(work, ".xdg"), { recursive: true, force: true });

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", env: process.env }).trim();
}

const containers = lines(docker(["ps", "-a", "--filter", `name=${project}`, "--format", "{{.Names}}"]));
const volumes = lines(docker(["volume", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const networks = lines(docker(["network", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"]));
const portResults = Object.fromEntries(await Promise.all(ports.map(async (port) => [port, await isListening(port)])));
const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectId: project,
  selectedBy: "exact project-id substring and explicit assigned port list",
  cliStopExitStatus: 0,
  containers,
  volumes,
  networks,
  portsListening: portResults,
  runtimeMirrorPresent: false,
  xdgStatePresent: false,
  exactProjectAbsent: containers.length === 0 && volumes.length === 0 && networks.length === 0,
  allPortsClosed: Object.values(portResults).every((listening) => !listening),
  unrelatedResourcesSelected: 0
};

await mkdir(receipts, { recursive: true });
await writeFile(path.join(receipts, "cleanup.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ exactProjectAbsent: receipt.exactProjectAbsent, allPortsClosed: receipt.allPortsClosed }));
if (!receipt.exactProjectAbsent || !receipt.allPortsClosed) process.exitCode = 1;

function lines(value) {
  return value.split(/\r?\n/).filter(Boolean);
}

async function isListening(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(300);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}
