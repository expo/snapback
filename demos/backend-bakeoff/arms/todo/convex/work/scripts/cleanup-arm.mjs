#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const targets = [
  path.resolve(workRoot, ".convex"),
  path.resolve(armRoot, "runtime"),
  path.resolve(workRoot, ".arm-secrets.json"),
  path.resolve(workRoot, ".env.local"),
];
if (
  path.basename(armRoot) !== "convex" ||
  path.basename(path.dirname(armRoot)) !== "todo"
) {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}

function listener(port) {
  try {
    const pid = Number(execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    ).trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
    const parent = Number(execFileSync("ps", ["-p", String(pid), "-o", "ppid="], {
      encoding: "utf8",
    }).trim());
    const parentCommand = parent > 1
      ? execFileSync("ps", ["-p", String(parent), "-o", "command="], {
          encoding: "utf8",
        }).trim()
      : "";
    return { pid, command, parent, parentCommand };
  } catch {
    return null;
  }
}

const convex = listener(3210);
if (
  convex &&
  (!convex.command.includes("convex-local-backend") ||
    !convex.command.includes(path.resolve(workRoot, ".convex/local")) ||
    !convex.parentCommand.includes("convex dev"))
) {
  throw new Error("refusing to stop non-arm Convex listener");
}
const vite = listener(4179);
if (
  vite &&
  (!vite.command.includes("vite") || !vite.command.includes(workRoot))
) {
  throw new Error("refusing to stop non-arm Vite listener");
}
if (convex) process.kill(convex.parent, "SIGTERM");
if (vite) process.kill(vite.pid, "SIGTERM");

for (let attempt = 0; attempt < 50; attempt += 1) {
  if ([3210, 3211, 4179].every((port) => listener(port) === null)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
for (const port of [3210, 3211, 4179]) {
  if (listener(port)) throw new Error(`arm listener on ${port} did not stop`);
}
for (const target of targets) await rm(target, { recursive: true, force: true });

async function absent(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}
const probes = {
  port3210Closed: listener(3210) === null,
  port3211Closed: listener(3211) === null,
  port4179Closed: listener(4179) === null,
  convexStateAbsent: await absent(targets[0]),
  browserRuntimeAbsent: await absent(targets[1]),
  armSecretsAbsent: await absent(targets[2]),
  envLocalAbsent: await absent(targets[3]),
};
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: Object.values(probes).every(Boolean),
  targetIdentityHash:
    "8a52ecbc24132f5197aa953ec3caa84149ca50f8ba46067086778e8ab6c9ee79",
  removed: [
    "exact arm-owned Convex local deployment",
    "exact arm-owned disposable browser profiles",
    "exact arm-local environment and proof files"
  ],
  probes,
  recovery:
    "Removed bytes are not recoverable; source and deterministic seed recreate them.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(armRoot, "receipts/cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok) process.exit(1);
