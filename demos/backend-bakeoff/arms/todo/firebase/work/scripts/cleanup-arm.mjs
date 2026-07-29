#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const secretsPath = path.resolve(workRoot, ".arm-secrets");
const ports = [4181, 8085, 9102, 4400, 4500, 9150];
if (
  path.basename(armRoot) !== "firebase" ||
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

const vite = listener(4181);
if (vite && (!vite.command.includes("vite") || !vite.command.includes("4181"))) {
  throw new Error("refusing to stop non-arm Vite listener");
}
const hub = listener(4400);
if (
  hub &&
  (
    !hub.command.includes("firebase") ||
    !hub.command.includes("emulators:start") ||
    !hub.command.includes("demo-llp0102-todo-firebase")
  )
) {
  throw new Error("refusing to stop a non-arm Firebase emulator hub");
}
const firestore = listener(8085);
if (firestore && !firestore.command.includes("cloud-firestore-emulator-v1.21.0.jar")) {
  throw new Error("refusing to stop a non-arm Firestore listener");
}
if (vite) process.kill(vite.pid, "SIGTERM");
if (hub) process.kill(hub.pid, "SIGINT");
for (let attempt = 0; attempt < 120 && ports.some((port) => listener(port)); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (ports.some((port) => listener(port))) {
  throw new Error("arm listeners did not stop");
}

await rm(runtimeRoot, { recursive: true, force: true });
await rm(secretsPath, { force: true });
await rm(path.resolve(workRoot, ".firebase"), { recursive: true, force: true });
for (const log of ["firebase-debug.log", "firestore-debug.log", "ui-debug.log"]) {
  await rm(path.resolve(workRoot, log), { force: true });
}

async function absent(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}
const probes = {
  port4181Closed: listener(4181) === null,
  port8085Closed: listener(8085) === null,
  port9102Closed: listener(9102) === null,
  port4400Closed: listener(4400) === null,
  port4500Closed: listener(4500) === null,
  port9150Closed: listener(9150) === null,
  runtimeAbsent: await absent(runtimeRoot),
  armSecretsAbsent: await absent(secretsPath),
  firebaseCacheAbsent: await absent(path.resolve(workRoot, ".firebase")),
  generatedLogsAbsent: await Promise.all(
    ["firebase-debug.log", "firestore-debug.log", "ui-debug.log"].map((log) =>
      absent(path.resolve(workRoot, log))
    ),
  ).then((values) => values.every(Boolean)),
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
    "exact arm-owned Firebase Auth and Firestore emulator processes and ephemeral data",
    "exact arm-owned Vite process and disposable browser profiles",
    "exact arm-local persona credential file and generated emulator logs/cache",
  ],
  retained: ["shared Firebase CLI and Firestore emulator download caches"],
  probes,
  recovery:
    "Removed target/runtime bytes are not recoverable; retained source, rules, deterministic seed, and shared emulator download recreate them.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(armRoot, "receipts/cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok) process.exit(1);
