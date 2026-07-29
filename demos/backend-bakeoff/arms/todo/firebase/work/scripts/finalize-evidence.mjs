#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const receiptsRoot = path.resolve(armRoot, "receipts");

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
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function admin(...args) {
  const result = await command(process.execPath, [
    path.resolve(workRoot, "scripts/admin-cli.mjs"),
    ...args,
  ]);
  if (result.code !== 0) throw new Error(result.stderr || `admin helper exited ${result.code}`);
  return JSON.parse(result.stdout);
}

const projectId = "demo-llp0102-todo-firebase";
const firebasePackage = JSON.parse(
  await readFile(path.resolve(workRoot, "node_modules/firebase/package.json"), "utf8"),
);
const adminPackage = JSON.parse(
  await readFile(path.resolve(workRoot, "node_modules/firebase-admin/package.json"), "utf8"),
);
const cliVersion = execFileSync(
  "npx",
  ["firebase", "--version"],
  { cwd: workRoot, encoding: "utf8" },
).trim();
const firestorePid = Number(execFileSync(
  "lsof", ["-nP", "-iTCP:8085", "-sTCP:LISTEN", "-t"], { encoding: "utf8" },
).trim().split(/\s+/)[0]);
const firestoreCommand = execFileSync(
  "ps", ["-p", String(firestorePid), "-o", "command="], { encoding: "utf8" },
).trim();
if (!firestoreCommand.includes("cloud-firestore-emulator-v1.21.0.jar")) {
  throw new Error("Firestore emulator identity mismatch");
}
const jarPath = firestoreCommand.split(/\s+/).find((part) =>
  part.includes("cloud-firestore-emulator-v1.21.0.jar")
);
if (!jarPath) throw new Error("Firestore emulator jar path missing");
const jarSha256 = execFileSync("shasum", ["-a", "256", jarPath], { encoding: "utf8" })
  .trim().split(/\s+/)[0];
const targetIdentityHash = createHash("sha256")
  .update(JSON.stringify({
    projectId,
    firebaseClient: firebasePackage.version,
    firebaseAdmin: adminPackage.version,
    firebaseCli: cliVersion,
    firestoreEmulatorJarSha256: jarSha256,
  }))
  .digest("hex");
const summary = await admin("summary");
const personas = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "personas.v1.json"), "utf8"),
);

const auditProcess = await command("npm", ["audit", "--json"]);
let audit;
try {
  audit = JSON.parse(auditProcess.stdout);
} catch {
  throw new Error(`npm audit did not return JSON: ${auditProcess.stderr}`);
}
const auditReceipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  commandExitStatus: auditProcess.code,
  vulnerabilityCounts: audit.metadata?.vulnerabilities ?? {},
  affectedPackages: Object.keys(audit.vulnerabilities ?? {}).sort(),
  remediationApplied: false,
  classification:
    "Retained as dependency evidence; no automatic audit fix was applied because it could change the frozen provider/toolchain path.",
  containsSecretValues: false,
};
const authoritative = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok:
    summary.workspaceCount === 1 &&
    summary.membershipCount === 2 &&
    summary.listCount === 4 &&
    summary.taskCount === 100 &&
    summary.uniqueTaskIds === 100 &&
    summary.uniqueSeedKeys === 100 &&
    summary.orderValid,
  targetIdentityHash,
  target: {
    projectId,
    firebaseClient: firebasePackage.version,
    firebaseAdmin: adminPackage.version,
    firebaseCli: cliVersion,
    firestoreEmulator: "1.21.0",
    firestoreEmulatorJarSha256: jarSha256,
  },
  authoritative: summary,
  principalIdHashes: personas.principalIdHashes,
  containsSecretValues: false,
};
const cleanupPlan = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetMode: "fresh-local",
  targetIdentityHash,
  namespace: "llp0102-todo-firebase-calibration-todo-firebase-calibration-01",
  scope: {
    projectId,
    runtimeDirectories: ["arms/todo/firebase/runtime"],
    listenerPorts: [4181, 8085, 9102, 4400, 4500, 9150],
    credentialFiles: ["arms/todo/firebase/work/.arm-secrets"],
    logs: [
      "arms/todo/firebase/work/firebase-debug.log",
      "arms/todo/firebase/work/firestore-debug.log",
      "arms/todo/firebase/work/ui-debug.log",
    ],
  },
  steps: [
    "Resolve the Vite listener and verify its process command belongs to this exact arm.",
    "Resolve the emulator hub and verify its command includes the exact demo project and emulators:start.",
    "Stop only those two exact process owners and prove all six arm ports closed.",
    "Remove only the arm runtime tree, arm-local credential file, and generated emulator logs/cache.",
    "Probe all declared ports and paths for absence.",
  ],
  recovery:
    "Removed emulator/auth data and browser profiles are not recoverable; retained source, rules, deterministic seed, and shared emulator download recreate them.",
  containsSecretValues: false,
};
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetIdentityHash,
  authoritativeTaskCount: summary.taskCount,
  activeMemberCount: summary.membershipCount,
  retainedEvidence: [
    "authoritative-summary.v1.json",
    "personas.v1.json",
    "correctness-smoke.v1.json",
    "offline-smoke.v1.json",
    "performance.v1.json",
    "dependency-audit.v1.json",
    "inventory.v1.json",
  ],
  dataExport: {
    status: "explicit-gap",
    reason:
      "The disposable emulator export contains arm-local credentials and is deleted; deterministic seed and source recreate the tested state.",
  },
  containsSecretValues: false,
};

await mkdir(receiptsRoot, { recursive: true });
for (const [name, value] of [
  ["authoritative-summary.v1.json", authoritative],
  ["cleanup-plan.v1.json", cleanupPlan],
  ["backup-manifest.v1.json", backup],
  ["dependency-audit.v1.json", auditReceipt],
]) {
  await writeFile(path.resolve(receiptsRoot, name), `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
process.stdout.write(`${JSON.stringify({
  ok: authoritative.ok,
  targetIdentityHash,
  authoritative: summary,
  dependencyAudit: auditReceipt.vulnerabilityCounts,
  secretValuesPrinted: false,
})}\n`);
