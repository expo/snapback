#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const convexBin = path.resolve(workRoot, "node_modules/.bin/convex");
const { adminProof } = JSON.parse(
  await readFile(path.resolve(workRoot, ".arm-secrets.json"), "utf8"),
);
if (typeof adminProof !== "string" || adminProof.length < 32) {
  throw new Error("arm-local admin proof is missing");
}

const [action, subject, secondSubject] = process.argv.slice(2);
const calls = {
  seed: ["todo:seed", { proof: adminProof }],
  summary: ["todo:authoritativeSummary", { proof: adminProof }],
  probe: ["todo:authoritativeTask", { proof: adminProof, taskId: subject }],
  grant: ["todo:grantMember", { proof: adminProof, userId: subject, role: "member" }],
  provision: [
    "todo:provisionMembers",
    { proof: adminProof, aliceUserId: subject, bobUserId: secondSubject },
  ],
  cleanup: ["todo:cleanupMarkers", { proof: adminProof, prefix: subject }],
  revoke: ["todo:revokeMember", { proof: adminProof, userId: subject }],
};
const call = calls[action];
if (
  !call ||
  ((action === "grant" ||
    action === "revoke" ||
    action === "cleanup" ||
    action === "probe") &&
    !subject) ||
  (action === "provision" && (!subject || !secondSubject))
) {
  throw new Error(
    "usage: node scripts/admin-cli.mjs <seed|summary|probe|grant|revoke|provision|cleanup> [subject] [second-subject]",
  );
}

const output = await new Promise((resolve, reject) => {
  const child = spawn(convexBin, ["run", call[0], JSON.stringify(call[1])], {
    cwd: workRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(stderr.trim() || stdout.trim() || `convex exited ${code}`));
  });
});

if (action === "summary") {
  const summary = JSON.parse(output);
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      summary?.taskCount === 100 &&
      summary?.listCount === 4 &&
      summary?.listOrderSizes?.every((size) => size === 25),
    ...summary,
    queryClass: "admin-proof-authoritative-query",
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/authoritative-summary.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 1;
} else if (action === "probe") {
  process.stdout.write(`${output}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, action })}\n`);
}
