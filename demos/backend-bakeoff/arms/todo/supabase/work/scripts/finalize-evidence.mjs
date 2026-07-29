#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const receiptsRoot = path.resolve(armRoot, "receipts");
const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");

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

const clientPackage = JSON.parse(
  await readFile(path.resolve(workRoot, "node_modules/@supabase/supabase-js/package.json"), "utf8"),
);
const baseline = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "baseline.v1.json"), "utf8"),
);
const personas = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "personas.v1.json"), "utf8"),
);
const summary = await admin("summary");
const targetProbe = await admin("target-probe");
const targetIdentity = {
  projectHostHash: hash(new URL(env.VITE_SUPABASE_URL).hostname),
  directPoolerHostHash: hash(new URL(env.DIRECT_URL).hostname),
  poolerRegionHint: targetProbe.poolerRegionHint,
  serverVersion: targetProbe.serverVersion,
  clientVersion: clientPackage.version,
  namespacePrefix: "llp0102_todo_sb01_",
};
const targetIdentityHash = hash(JSON.stringify(targetIdentity));

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
    summary.orderValid &&
    targetProbe.matchingRelations === 4 &&
    targetProbe.matchingPublicationRelations === 4 &&
    targetProbe.matchingPersonaUsers === 3,
  targetIdentityHash,
  targetIdentity,
  authoritative: summary,
  namespaceObjects: {
    relations: targetProbe.matchingRelations,
    realtimePublicationRelations: targetProbe.matchingPublicationRelations,
    policies: targetProbe.matchingPolicies,
    personaUsers: targetProbe.matchingPersonaUsers,
  },
  principalIdHashes: personas.principalIdHashes,
  containsSecretValues: false,
};
const cleanupPlan = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetMode: "namespace-isolated-shared-hosted",
  targetIdentityHash,
  namespace: baseline.namespace,
  baselineReceiptPath: "receipts/baseline.v1.json",
  baselineWasEmpty: baseline.ok,
  scope: {
    publicRelationPrefix: "llp0102_todo_sb01_",
    exactRelations: [
      "llp0102_todo_sb01_tasks",
      "llp0102_todo_sb01_lists",
      "llp0102_todo_sb01_memberships",
      "llp0102_todo_sb01_workspaces",
    ],
    exactFunctions: [
      "llp0102_todo_sb01_create_task",
      "llp0102_todo_sb01_patch_task",
      "llp0102_todo_sb01_delete_task",
      "llp0102_todo_sb01_is_member",
    ],
    realtimePublication: "supabase_realtime",
    exactPersonaIdHashes: targetProbe.matchingPersonaUserIdHashes,
    localRuntimeDirectories: ["arms/todo/supabase/runtime"],
    localCredentialFiles: [
      "arms/todo/supabase/work/.arm-secrets",
      "arms/todo/supabase/work/.env.local",
    ],
    vitePort: 4182,
  },
  steps: [
    "Verify the current target hash and exact four relations, four publication entries, and three arm-metadata personas.",
    "Resolve port 4182 and stop it only if its command is the exact arm Vite process.",
    "Delete only the three exact persona users after verifying arm namespace metadata.",
    "Execute the retained transaction that removes only the exact publication entries, functions, and relations.",
    "Compare the redacted post-cleanup probe with the redacted zero-object baseline.",
    "Remove only the arm runtime tree and ignored arm-local credential files.",
  ],
  recovery:
    "The deleted arm namespace and personas are not recoverable; retained migration, deterministic seed, and ignored credentials can recreate them. Unrelated shared-project state is outside cleanup scope.",
  containsSecretValues: false,
};
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetIdentityHash,
  authoritativeTaskCount: summary.taskCount,
  activeMemberCount: summary.membershipCount,
  retainedEvidence: [
    "baseline.v1.json",
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
      "No shared-target data export is retained because cleanup must erase the isolated namespace; migration and deterministic seed recreate it.",
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
  targetProbe: {
    matchingRelations: targetProbe.matchingRelations,
    matchingPublicationRelations: targetProbe.matchingPublicationRelations,
    matchingPolicies: targetProbe.matchingPolicies,
    matchingPersonaUsers: targetProbe.matchingPersonaUsers,
    poolerRegionHint: targetProbe.poolerRegionHint,
  },
  dependencyAudit: auditReceipt.vulnerabilityCounts,
  secretValuesPrinted: false,
})}\n`);
