#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
if (
  path.basename(armRoot) !== "supabase" ||
  path.basename(path.dirname(armRoot)) !== "todo"
) {
  throw new Error(`refusing cleanup for unexpected arm root: ${armRoot}`);
}
const cleanupPlan = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/cleanup-plan.v1.json"), "utf8"),
);
const baseline = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/baseline.v1.json"), "utf8"),
);
if (!baseline.ok || !cleanupPlan.baselineWasEmpty) {
  throw new Error("refusing shared-target cleanup without the clean frozen baseline");
}

function command(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: workRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `${commandName} exited ${code}`));
    });
  });
}

async function admin(...args) {
  return JSON.parse(await command(process.execPath, [
    path.resolve(workRoot, "scripts/admin-cli.mjs"),
    ...args,
  ]));
}

function listener(port) {
  try {
    const pid = Number(requireOutput(
      "lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    ).split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    return {
      pid,
      command: requireOutput("ps", ["-p", String(pid), "-o", "command="]),
    };
  } catch {
    return null;
  }
}

function requireOutput(commandName, args) {
  const result = spawnSync(commandName, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${commandName} failed`);
  return result.stdout.trim();
}

const before = await admin("target-probe");
if (
  before.matchingRelations !== 4 ||
  before.matchingPublicationRelations !== 4 ||
  before.matchingPersonaUsers !== 3 ||
  JSON.stringify(before.matchingPersonaUserIdHashes) !==
    JSON.stringify(cleanupPlan.scope.exactPersonaIdHashes)
) {
  throw new Error("shared target no longer matches the target-bound cleanup plan");
}
const vite = listener(4182);
if (
  vite &&
  (
    !vite.command.includes("vite") ||
    !vite.command.includes(workRoot) ||
    !vite.command.includes("4182")
  )
) {
  throw new Error("refusing to stop a non-arm Vite listener");
}
if (vite) process.kill(vite.pid, "SIGTERM");
for (let attempt = 0; attempt < 50 && listener(4182); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (listener(4182)) throw new Error("arm Vite listener did not stop");

const deletedPersonas = await admin("delete-personas");
if (
  deletedPersonas.removed !== 3 ||
  JSON.stringify(deletedPersonas.removedIdHashes) !==
    JSON.stringify(cleanupPlan.scope.exactPersonaIdHashes)
) {
  throw new Error("persona cleanup did not match the exact planned identities");
}
await admin("drop-target");
const after = await admin("target-probe");
const baselineRestored =
  after.matchingRelations === baseline.baseline.matchingRelations.length &&
  after.matchingPublicationRelations ===
    baseline.baseline.matchingPublicationRelations.length &&
  after.matchingPersonaUsers === baseline.baseline.matchingPersonaUserIdHashes.length;
if (!baselineRestored) {
  throw new Error("shared target did not return to the redacted baseline");
}

await rm(runtimeRoot, { recursive: true, force: true });
await rm(path.resolve(workRoot, ".arm-secrets"), { force: true });
await rm(path.resolve(workRoot, ".env.local"), { force: true });

async function absent(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}
const probes = {
  port4182Closed: listener(4182) === null,
  matchingRelationsRestored: after.matchingRelations === 0,
  matchingPublicationRelationsRestored: after.matchingPublicationRelations === 0,
  matchingPoliciesRestored: after.matchingPolicies === 0,
  matchingPersonaUsersRestored: after.matchingPersonaUsers === 0,
  runtimeAbsent: await absent(runtimeRoot),
  armSecretsAbsent: await absent(path.resolve(workRoot, ".arm-secrets")),
  publicEnvAbsent: await absent(path.resolve(workRoot, ".env.local")),
};
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: Object.values(probes).every(Boolean),
  targetIdentityHash: cleanupPlan.targetIdentityHash,
  baselineReceiptPath: "receipts/baseline.v1.json",
  removed: [
    "exact four llp0102_todo_sb01_ public relations and their dependent policies/indexes",
    "exact four arm functions and four supabase_realtime publication entries",
    "exact three Auth users after arm namespace-metadata verification",
    "exact arm Vite process, disposable browser profiles, and ignored credential files",
  ],
  retained: [
    "all unrelated shared Supabase project relations, publication entries, identities, and data",
    "installed arm dependencies and retained deterministic migration/seed source",
  ],
  postCleanupNamespaceProbe: {
    matchingRelations: after.matchingRelations,
    matchingPublicationRelations: after.matchingPublicationRelations,
    matchingPolicies: after.matchingPolicies,
    matchingPersonaUsers: after.matchingPersonaUsers,
  },
  probes,
  recovery:
    "Deleted arm namespace and personas are not recoverable; retained migration and deterministic seed recreate them. Unrelated shared-project state was not in cleanup scope.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(armRoot, "receipts/cleanup.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok) process.exit(1);
