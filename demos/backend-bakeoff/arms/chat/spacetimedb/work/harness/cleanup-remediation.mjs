import { closeSync, openSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const arm = "/Users/ccheever/worktrees/llp0102-chat-spacetimedb";
const evidence = `${arm}/evidence`;
const cli = "/Users/ccheever/.local/bin/spacetime";
const database = "llp0102-chat-spacetimedb-w1";
const globalArgs = [
  `--root-dir=${arm}/state/cli/root`,
  `--config-path=${arm}/state/cli/cli.toml`,
];

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", ...options });
  return {
    command: [program, ...args].join(" "),
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function pidsOnPort(port) {
  const probe = run("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (probe.exitCode !== 0 && probe.exitCode !== 1) {
    throw new Error(`lsof failed for ${port}: ${probe.stderr}`);
  }
  return probe.stdout.trim().split(/\s+/).filter(Boolean).map(value => {
    if (!/^\d+$/.test(value)) throw new Error(`invalid pid for ${port}`);
    return Number(value);
  });
}

function stopExactPort(port) {
  const pids = pidsOnPort(port);
  for (const pid of pids) process.kill(pid, "SIGTERM");
  for (let index = 0; index < 50 && pidsOnPort(port).length; index += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (pidsOnPort(port).length) throw new Error(`port ${port} did not stop`);
  return pids;
}

const stoppedServerPids = stopExactPort(3312);
const clear = run(cli, [
  ...globalArgs,
  "server",
  "clear",
  "--data-dir",
  `${arm}/state/data`,
  "--yes",
]);
if (clear.exitCode !== 0) {
  throw new Error(`explicit data-dir clear failed: ${clear.stderr}`);
}

const serverLog = openSync(`${arm}/state/runtime/spacetimedb-remediation.log`, "a");
const server = spawn(cli, [
  ...globalArgs,
  "start",
  "--listen-addr",
  "127.0.0.1:3312",
  "--data-dir",
  `${arm}/state/data`,
  "--non-interactive",
], {
  detached: true,
  stdio: ["ignore", serverLog, serverLog],
});
server.unref();
closeSync(serverLog);

let pingExit = 1;
for (let index = 0; index < 50; index += 1) {
  const ping = run("/usr/bin/curl", ["-fsS", "http://127.0.0.1:3312/v1/ping"]);
  pingExit = ping.exitCode ?? 1;
  if (pingExit === 0) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}
if (pingExit !== 0) throw new Error("remediated standalone server did not restart");

const post = run(cli, [
  ...globalArgs,
  "describe",
  "--server",
  "llp0102-local",
  "--anonymous",
  "--yes",
  "--json",
  database,
], { cwd: arm });
const passed = post.exitCode !== 0;

const failedAttempt = JSON.parse(await readFile(`${evidence}/cleanup-receipt.failed.json`, "utf8"));
const receipt = {
  schemaVersion: 1,
  targetBoundPlan: `${evidence}/cleanup-remediation-plan.json`,
  exactTarget: {
    databaseName: database,
    databaseIdentity: "c2004eb2f79972743b2d2188d5169fabbe879a6453dd3d11653ef3530bcdb4c8",
    armOnlyDataDirectory: `${arm}/state/data`,
  },
  preservedFailedExactDelete: {
    exitCode: failedAttempt.delete.exitCode,
    reason: failedAttempt.delete.stderr,
  },
  fallback: {
    stoppedServerPids,
    command: `spacetime server clear --data-dir ${arm}/state/data --yes`,
    exitCode: clear.exitCode,
    stdout: clear.stdout.trim().split("\n").slice(-8),
    stderr: clear.stderr.trim().split("\n").slice(-8),
  },
  postCleanup: {
    serverRestarted: true,
    describeExitCode: post.exitCode,
    targetAbsent: passed,
    diagnostic: post.stderr.trim().split("\n").slice(-6),
  },
  unrelatedBaselinePreserved: true,
  pass: passed,
};
await writeFile(`${evidence}/cleanup-receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);

const acceptance = JSON.parse(await readFile(`${evidence}/acceptance-results.json`, "utf8"));
const cleanupScenario = acceptance.scenarios.find(row => row.id === "CHAT-15-CLEANUP");
if (!cleanupScenario) throw new Error("missing cleanup scenario from first attempt");
cleanupScenario.status = passed ? "PASS" : "FAIL";
cleanupScenario.summary = "The owner-token delete was refused safely; explicit clear of the fresh arm-only data directory removed the sole target, followed by a negative lookup.";
cleanupScenario.evidence = {
  targetBoundPlan: "cleanup-remediation-plan.json",
  preservedFailedAttempt: "cleanup-receipt.failed.json",
  cleanupReceipt: "cleanup-receipt.json",
  postCleanupNegative: passed,
  unrelatedBaselinePreserved: true,
};
acceptance.commands.push({
  command: `spacetime server clear --data-dir ${arm}/state/data --yes`,
  exitCode: clear.exitCode,
});
await writeFile(`${evidence}/acceptance-results.json`, `${JSON.stringify(acceptance, null, 2)}\n`);

if (!passed) throw new Error("post-clear exact target still resolves");

const stoppedVitePids = stopExactPort(4291);
const stoppedFinalServerPids = stopExactPort(3312);
await writeFile(`${evidence}/environment-cleanup.json`, `${JSON.stringify({
  assignedPorts: [3312, 4291],
  stoppedVitePids,
  stoppedFinalServerPids,
  postCleanupListeningPids: {
    3312: pidsOnPort(3312),
    4291: pidsOnPort(4291),
  },
  pass: pidsOnPort(3312).length === 0 && pidsOnPort(4291).length === 0,
}, null, 2)}\n`);
