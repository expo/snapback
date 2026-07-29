#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const receiptsRoot = path.resolve(armRoot, "receipts");
const runtimeRoot = path.resolve(armRoot, "runtime");

function admin(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve(workRoot, "scripts/admin-cli.mjs"),
      ...args,
    ], { cwd: workRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(stderr || `admin helper exited ${code}`));
    });
  });
}

const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const upstreamCommit = execFileSync(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: path.resolve(runtimeRoot, "instant"), encoding: "utf8" },
).trim();
const imageIds = ["postgres", "minio", "server"].map((service) =>
  execFileSync("docker", [
    "inspect",
    "--format",
    "{{.Image}}",
    `llp0102_todo_instantdb-${service}-1`,
  ], { encoding: "utf8" }).trim()
);
const targetIdentityHash = createHash("sha256")
  .update(JSON.stringify({
    project: "llp0102_todo_instantdb",
    appId: env.VITE_INSTANT_APP_ID,
    upstreamCommit,
    imageIds,
  }))
  .digest("hex");
const summary = await admin("summary");
const personas = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "personas.v1.json"), "utf8"),
);

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
  upstreamCommit,
  dockerComposeProjectHash: createHash("sha256")
    .update("llp0102_todo_instantdb")
    .digest("hex"),
  authoritative: summary,
  principalIdHashes: personas.principalIdHashes,
  containsSecretValues: false,
};
const cleanupPlan = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  targetMode: "fresh-local",
  targetIdentityHash,
  namespace: "llp0102-todo-instantdb-calibration-todo-instantdb-calibration-01",
  scope: {
    dockerComposeProject: "llp0102_todo_instantdb",
    runtimeDirectories: ["arms/todo/instantdb/runtime"],
    listenerPorts: [4180, 8889, 8891, 9100, 9101],
    credentialFiles: ["arms/todo/instantdb/work/.arm-secrets"],
  },
  steps: [
    "Resolve the Vite listener and verify its process command belongs to this exact arm.",
    "Verify every Docker container carries the exact llp0102_todo_instantdb Compose project label.",
    "Run Compose down with volumes only for that exact project.",
    "Remove only the arm runtime tree and arm-local credential file.",
    "Probe all five ports, the Compose project, and both paths for absence.",
  ],
  recovery:
    "Removed target/runtime bytes are not recoverable; retained source, schema, deterministic seed, and official images recreate them.",
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
    "inventory.v1.json",
  ],
  dataExport: {
    status: "explicit-gap",
    reason:
      "No logical export is retained for the disposable local target; deterministic seed and source recreate the tested state.",
  },
  containsSecretValues: false,
};

await mkdir(receiptsRoot, { recursive: true });
for (const [name, value] of [
  ["authoritative-summary.v1.json", authoritative],
  ["cleanup-plan.v1.json", cleanupPlan],
  ["backup-manifest.v1.json", backup],
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
  secretValuesPrinted: false,
})}\n`);
