#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workRoot = path.resolve(scriptDirectory, "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const receiptPath = path.resolve(armRoot, "receipts/cleanup.v1.json");
const credentialPaths = [
  path.resolve(workRoot, ".arm-secrets.json"),
  path.resolve(workRoot, ".env.local"),
];

if (
  path.basename(armRoot) !== "spacetimedb" ||
  path.basename(path.dirname(armRoot)) !== "todo" ||
  path.dirname(runtimeRoot) !== armRoot
) {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}

function listener(port) {
  try {
    const pid = Number(execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    ).trim());
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const command = execFileSync(
      "ps",
      ["-p", String(pid), "-o", "command="],
      { encoding: "utf8" },
    ).trim();
    return { pid, command };
  } catch {
    return null;
  }
}

const targets = [
  {
    port: 3102,
    requiredCommandFragments: [
      "spacetimedb-standalone",
      armRoot,
      "work/../runtime/data",
    ],
  },
  {
    port: 4178,
    requiredCommandFragments: ["vite", workRoot],
  },
];

for (const target of targets) {
  const current = listener(target.port);
  if (!current) continue;
  if (!target.requiredCommandFragments.every((fragment) => current.command.includes(fragment))) {
    throw new Error(
      `refusing to stop non-arm listener on ${target.port}: ${current.command}`,
    );
  }
  process.kill(current.pid, "SIGTERM");
}

for (let attempt = 0; attempt < 50; attempt += 1) {
  if (targets.every((target) => listener(target.port) === null)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
for (const target of targets) {
  if (listener(target.port) !== null) {
    throw new Error(`arm listener on ${target.port} did not stop`);
  }
}

await rm(runtimeRoot, { recursive: true, force: true });
for (const credentialPath of credentialPaths) {
  await rm(credentialPath, { force: true });
}

async function absent(targetPath) {
  try {
    await access(targetPath);
    return false;
  } catch {
    return true;
  }
}

const probes = {
  port3102Closed: listener(3102) === null,
  port4178Closed: listener(4178) === null,
  runtimeDirectoryAbsent: await absent(runtimeRoot),
  armSecretsAbsent: await absent(credentialPaths[0]),
  envLocalAbsent: await absent(credentialPaths[1]),
};
const ok = Object.values(probes).every(Boolean);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok,
  targetIdentityHash:
    "1d69c47ca499a7f5b31d656b6fb7bef31a0d528d91553e6c126fd1fe8fbebc9c",
  removed: [
    "exact arm-owned standalone database directory (two local attempts)",
    "exact arm-owned disposable browser profiles",
    "exact arm-local ignored credential files",
  ],
  probes,
  recovery:
    "Removed target bytes are not recoverable; source and deterministic seed can recreate them.",
  containsSecretValues: false,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!ok) process.exit(1);
