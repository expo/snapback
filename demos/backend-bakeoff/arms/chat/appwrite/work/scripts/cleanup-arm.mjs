#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const installerRoot = path.resolve(workRoot, ".arm-runtime");
if (path.basename(armRoot) !== "appwrite" || path.basename(path.dirname(armRoot)) !== "chat") {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}
const cleanupPlan = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/cleanup-plan.v1.json"), "utf8"),
);
if (!cleanupPlan.baselineWasEmpty || cleanupPlan.scope.apiPort !== 8090) {
  throw new Error("refusing cleanup without the frozen empty target plan");
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: workRoot, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
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
  const pid = Number(result.stdout.trim().split(/\s+/)[0]);
  const command = run("ps", ["-p", String(pid), "-o", "command="]);
  return { pid, command };
}

const vite = listener(4186);
if (vite && (!vite.command.includes("vite") || !vite.command.includes("4186"))) {
  throw new Error("refusing to stop a non-arm listener on port 4186");
}
if (vite) process.kill(vite.pid, "SIGTERM");

const installerIds = run(
  "docker",
  ["ps", "-q", "--filter", "ancestor=appwrite/appwrite:1.9.6", "--filter", "publish=20080"],
  { allowFailure: true },
).split(/\s+/).filter(Boolean);
if (installerIds.length > 1) throw new Error("multiple matching web installers found");
if (installerIds[0]) run("docker", ["stop", installerIds[0]]);

const composeFile = path.resolve(installerRoot, "appwrite/docker-compose.yml");
const envFile = path.resolve(installerRoot, "appwrite/.env");
await access(composeFile);
await access(envFile);
run("docker", [
  "compose",
  "--env-file", envFile,
  "-f", composeFile,
  "--project-directory", path.dirname(composeFile),
  "down",
  "-v",
  "--remove-orphans",
]);

const prefsPath = path.join(homedir(), ".appwrite", "prefs.json");
const prefs = JSON.parse(await readFile(prefsPath, "utf8"));
const sessionIds = Object.keys(prefs).filter((key) => key !== "current");
if (
  sessionIds.length !== 1 ||
  prefs.current !== sessionIds[0] ||
  prefs[sessionIds[0]]?.endpoint !== "http://127.0.0.1:8090/v1"
) {
  throw new Error("refusing to remove Appwrite CLI preferences with unexpected sessions");
}
await rm(prefsPath);
const prefsDir = path.dirname(prefsPath);
if ((await readdir(prefsDir)).length === 0) await rmdir(prefsDir);

await rm(runtimeRoot, { recursive: true, force: true });
await rm(installerRoot, { recursive: true, force: true });
await rm(path.resolve(workRoot, ".agents"), { recursive: true, force: true });
await rm(path.resolve(workRoot, ".claude"), { recursive: true, force: true });

async function absent(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}
const remainingContainers = run(
  "docker",
  ["ps", "-a", "--format", "{{.Names}}"],
  { allowFailure: true },
).split("\n").filter((name) => name === "exc1" || name.startsWith("appwrite"));
const remainingVolumes = run(
  "docker",
  ["volume", "ls", "--format", "{{.Name}}"],
  { allowFailure: true },
).split("\n").filter((name) => name.startsWith("appwrite_"));
const remainingNetworks = run(
  "docker",
  ["network", "ls", "--format", "{{.Name}}"],
  { allowFailure: true },
).split("\n").filter((name) => name.startsWith("appwrite_"));
const probes = {
  port4186Closed: listener(4186) === null,
  port8090Closed: listener(8090) === null,
  port20080Closed: listener(20080) === null,
  matchingContainersRestored: remainingContainers.length === 0,
  matchingVolumesRestored: remainingVolumes.length === 0,
  matchingNetworksRestored: remainingNetworks.length === 0,
  runtimeAbsent: await absent(runtimeRoot),
  installerRuntimeAbsent: await absent(installerRoot),
  cliPreferencesAbsent: await absent(prefsPath),
};
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: Object.values(probes).every(Boolean),
  targetIdentityHash: cleanupPlan.targetIdentityHash,
  baselineReceiptPath: "receipts/baseline.v1.json",
  removed: [
    "exact official Appwrite Compose containers, named volumes, and network",
    "exact Appwrite 1.9.6 web installer publishing port 20080",
    "exact arm Vite process and disposable browser/runtime directories",
    "sole Appwrite CLI session after endpoint verification against the absent baseline",
  ],
  retained: [
    "Docker images, installed npm dependencies, deterministic provisioning source, and evidence",
    "all unrelated Docker and filesystem state",
  ],
  probes,
  recovery:
    "Removed local Appwrite data is not recoverable; retained installer and provisioning source recreate it.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(armRoot, "receipts/cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok) process.exit(1);
