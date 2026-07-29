#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const secretsPath = path.resolve(workRoot, ".arm-secrets");
if (
  path.basename(armRoot) !== "instantdb" ||
  path.basename(path.dirname(armRoot)) !== "todo"
) {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}

function output(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

function listener(port) {
  try {
    const pid = Number(output("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
      .split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    return {
      pid,
      command: output("ps", ["-p", String(pid), "-o", "command="]),
    };
  } catch {
    return null;
  }
}

const vite = listener(4180);
if (vite && (!vite.command.includes("vite") || !vite.command.includes(workRoot))) {
  throw new Error("refusing to stop non-arm Vite listener");
}
const containerIds = output("docker", [
  "ps", "-aq", "--filter", "label=com.docker.compose.project=llp0102_todo_instantdb",
]).split(/\s+/).filter(Boolean);
if (containerIds.length === 0) throw new Error("arm Compose project is missing");
for (const id of containerIds) {
  const project = output("docker", [
    "inspect", "--format",
    "{{ index .Config.Labels \"com.docker.compose.project\" }}",
    id,
  ]);
  if (project !== "llp0102_todo_instantdb") {
    throw new Error(`refusing to remove container outside arm project: ${id}`);
  }
}
if (vite) process.kill(vite.pid, "SIGTERM");
for (let attempt = 0; attempt < 50 && listener(4180); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (listener(4180)) throw new Error("arm Vite listener did not stop");

execFileSync("docker", [
  "compose",
  "-p", "llp0102_todo_instantdb",
  "-f", path.resolve(runtimeRoot, "instant/self-hosting/docker-compose.yml"),
  "-f", path.resolve(runtimeRoot, "instant/self-hosting/docker-compose.arm.yml"),
  "--env-file", path.resolve(runtimeRoot, "instant/self-hosting/.env.arm"),
  "down", "-v", "--remove-orphans",
], { stdio: "ignore" });

await rm(runtimeRoot, { recursive: true, force: true });
await rm(secretsPath, { force: true });

async function absent(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}
const remainingContainers = output("docker", [
  "ps", "-aq", "--filter", "label=com.docker.compose.project=llp0102_todo_instantdb",
]);
const probes = {
  port4180Closed: listener(4180) === null,
  port8889Closed: listener(8889) === null,
  port8891Closed: listener(8891) === null,
  port9100Closed: listener(9100) === null,
  port9101Closed: listener(9101) === null,
  composeProjectAbsent: remainingContainers === "",
  runtimeAbsent: await absent(runtimeRoot),
  armSecretsAbsent: await absent(secretsPath),
};
const cleanupPlan = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/cleanup-plan.v1.json"), "utf8"),
);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: Object.values(probes).every(Boolean),
  targetIdentityHash: cleanupPlan.targetIdentityHash,
  removed: [
    "exact arm-owned InstantDB Compose containers, network, and named volumes",
    "exact arm-owned upstream clone and disposable browser profiles",
    "exact arm-local application and Compose credential files",
  ],
  retained: ["shared Docker image cache"],
  probes,
  recovery:
    "Removed target/runtime bytes are not recoverable; retained source, deterministic seed, and official images recreate them.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(armRoot, "receipts/cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok) process.exit(1);
