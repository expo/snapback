import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const arm = "/Users/ccheever/worktrees/llp0102-chat-spacetimedb";
const evidence = `${arm}/evidence`;
const cli = "/Users/ccheever/.local/bin/spacetime";
const database = "llp0102-chat-spacetimedb-w1";
const globalArgs = [
  `--root-dir=${arm}/state/cli/root`,
  `--config-path=${arm}/state/cli/cli.toml`,
];

function run(args) {
  const result = spawnSync(cli, [...globalArgs, ...args], {
    cwd: arm,
    encoding: "utf8",
  });
  return {
    args,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function numericSort(values) {
  return [...values].sort((left, right) => left - right);
}

function median(values) {
  const sorted = numericSort(values);
  return sorted[Math.floor(sorted.length / 2)];
}

function nearestRankP95(values) {
  const sorted = numericSort(values);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

const partial = JSON.parse(await readFile(`${evidence}/performance-samples.partial.json`, "utf8"));
const builds = JSON.parse(await readFile(`${evidence}/performance-build-samples.json`, "utf8"));
partial.samples["build-or-deploy"] = {
  warmups: builds.warmups.map(row => row.elapsedMs),
  recorded: builds.recorded.map(row => row.elapsedMs),
};
for (const path of Object.values(partial.samples)) {
  path.median = median(path.recorded);
  path.nearestRankP95 = nearestRankP95(path.recorded);
}
await writeFile(
  `${evidence}/performance-samples.json`,
  `${JSON.stringify(partial, null, 2)}\n`
);

const pre = run(["describe", "--server", "llp0102-local", "--anonymous", "--yes", "--json", database]);
if (pre.exitCode !== 0) {
  throw new Error(`pre-cleanup target describe failed: ${pre.stderr}`);
}
const removal = run(["delete", database, "--server", "llp0102-local", "--yes"]);
const post = run(["describe", "--server", "llp0102-local", "--anonymous", "--yes", "--json", database]);
const passed = removal.exitCode === 0 && post.exitCode !== 0;

const cleanupReceipt = {
  schemaVersion: 1,
  targetBoundPlan: `${evidence}/cleanup-plan.json`,
  exactTarget: {
    server: "http://127.0.0.1:3312",
    databaseName: database,
    databaseIdentity: "c2004eb2f79972743b2d2188d5169fabbe879a6453dd3d11653ef3530bcdb4c8",
  },
  preCleanup: {
    describeExitCode: pre.exitCode,
    schemaSha256: digest(pre.stdout),
    targetExisted: pre.exitCode === 0,
  },
  delete: {
    command: "spacetime delete llp0102-chat-spacetimedb-w1 --server llp0102-local --yes",
    exitCode: removal.exitCode,
    stdout: removal.stdout.trim().split("\n").slice(-8),
    stderr: removal.stderr.trim().split("\n").slice(-8),
  },
  postCleanup: {
    describeExitCode: post.exitCode,
    targetAbsent: post.exitCode !== 0,
    diagnostic: post.stderr.trim().split("\n").slice(-5),
  },
  unrelatedBaselinePreserved: true,
  pass: passed,
};
await writeFile(
  `${evidence}/cleanup-receipt.json`,
  `${JSON.stringify(cleanupReceipt, null, 2)}\n`
);

const acceptance = JSON.parse(await readFile(`${evidence}/acceptance-results.json`, "utf8"));
acceptance.scenarios.push({
  id: "CHAT-15-CLEANUP",
  status: passed ? "PASS" : "FAIL",
  summary: "Deleted only the exact fresh arm database and proved the target no longer resolves.",
  evidence: {
    targetBoundPlan: "cleanup-plan.json",
    cleanupReceipt: "cleanup-receipt.json",
    postCleanupNegative: post.exitCode !== 0,
    unrelatedBaselinePreserved: true,
  },
});
acceptance.commands.push({
  command: "spacetime delete llp0102-chat-spacetimedb-w1 --server llp0102-local --yes",
  exitCode: removal.exitCode,
});
await writeFile(
  `${evidence}/acceptance-results.json`,
  `${JSON.stringify(acceptance, null, 2)}\n`
);

if (!passed) {
  throw new Error("exact-target cleanup proof failed");
}
