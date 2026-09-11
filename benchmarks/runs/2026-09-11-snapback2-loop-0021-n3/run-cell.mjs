#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const M1_DEADLINE_MS = 1_200_000;
const CELL_CAP_MS = 3_600_000;
const REPLICATES = new Map([
  ["astra-medium-01", "53100–53119"],
  ["astra-medium-02", "53200–53219"],
  ["astra-medium-03", "53300–53319"],
]);

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write("usage: node run-cell.mjs --root <execution-root> --replicate <astra-medium-01|02|03>\n");
  process.exit(2);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--root" && arg !== "--replicate") usage(`unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value) usage(`missing value for ${arg}`);
    values[arg.slice(2)] = value;
    index += 1;
  }
  if (!values.root || !values.replicate) usage();
  if (!REPLICATES.has(values.replicate)) usage(`unknown replicate: ${values.replicate}`);
  return values;
}

function command(path, args = []) {
  try {
    return execFileSync(path, args, { encoding: "utf8", timeout: 15_000 }).trim();
  } catch (error) {
    return `unavailable: ${error.message}`;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function json(path, value, flag = undefined) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined);
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

const { root: requestedRoot, replicate } = parseArgs(process.argv);
const root = resolve(requestedRoot);
const ordinal = [...REPLICATES.keys()].indexOf(replicate);
if (ordinal > 0) {
  const prior = [...REPLICATES.keys()][ordinal - 1];
  if (!existsSync(join(root, prior, "controller-terminal.json"))) {
    throw new Error(`serial execution refused: ${prior} has no terminal`);
  }
}

mkdirSync(root, { recursive: true });
const cellRoot = join(root, replicate);
mkdirSync(cellRoot, { recursive: false });
const appRoot = join(cellRoot, "app");
const evidenceRoot = join(appRoot, "evidence");
mkdirSync(evidenceRoot, { recursive: true });

const sourceBrief = readFileSync(join(SCRIPT_ROOT, "brief.md"), "utf8");
const prompt = sourceBrief
  .replaceAll("{{WORKING_DIRECTORY}}", appRoot)
  .replaceAll("{{PORT_RANGE}}", REPLICATES.get(replicate));
const promptPath = join(cellRoot, "prompt.md");
writeFileSync(promptPath, prompt);

const startedAt = new Date();
const startMillis = startedAt.getTime();
const environment = {
  schemaVersion: "snapback2-loop-cell-environment.v1",
  replicate,
  startedAt: startedAt.toISOString(),
  host: {
    computerName: command("/usr/sbin/scutil", ["--get", "ComputerName"]),
    hardwareModel: command("/usr/sbin/sysctl", ["-n", "hw.model"]),
    physicalCpu: command("/usr/sbin/sysctl", ["-n", "hw.physicalcpu"]),
    logicalCpu: command("/usr/sbin/sysctl", ["-n", "hw.logicalcpu"]),
    memoryBytes: command("/usr/sbin/sysctl", ["-n", "hw.memsize"]),
    osVersion: command("/usr/bin/sw_vers", ["-productVersion"]),
    architecture: command("/usr/bin/uname", ["-m"]),
    load: command("/usr/bin/uptime"),
  },
  tools: {
    node: { path: process.execPath, version: process.version },
    npm: command("/usr/bin/env", ["npm", "--version"]),
    codex: command("/usr/bin/env", ["codex", "--version"]),
    codexAuth: command("/usr/bin/env", ["codex", "login", "status"]),
  },
  package: {
    specifier: "snapback2@0.0.21",
    expectedIntegrity: "sha512-Mc2fRjWYmKW4rYhh+ksZ/Q4ZvM5JzyXxZ/IMRmDkXTgYUiJq03yYcYIodxp15mf8sePWjFR9g8u9MEi0K90zcw==",
    registryObservation: command("/usr/bin/env", ["npm", "view", "snapback2@0.0.21", "version", "dist.integrity", "--json"]),
  },
  harness: {
    model: "gpt-6-astra",
    effort: "medium",
    argv: ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "--model", "gpt-6-astra", "-c", 'model_reasoning_effort="medium"', "-"],
    m1DeadlineSeconds: M1_DEADLINE_MS / 1000,
    wholeCellCapSeconds: CELL_CAP_MS / 1000,
    promptSha256: sha256(prompt),
    sourceBriefSha256: sha256(sourceBrief),
  },
};
json(join(cellRoot, "environment.json"), environment, "wx");

const stdoutFd = openSync(join(cellRoot, "harness.stdout.jsonl"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
const stderrFd = openSync(join(cellRoot, "harness.stderr.log"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
const child = spawn("codex", environment.harness.argv, {
  cwd: appRoot,
  detached: true,
  env: { ...process.env },
  stdio: ["pipe", stdoutFd, stderrFd],
});
child.stdin.end(prompt);

process.stdout.write(`${JSON.stringify({ event: "started", replicate, pid: child.pid, at: startedAt.toISOString(), appRoot })}\n`);

let terminationReason = null;
let escalationTimer = null;
const heartbeat = setInterval(() => {
  const elapsedSeconds = Math.floor((Date.now() - startMillis) / 1000);
  const m1Green = existsSync(join(evidenceRoot, "m1-green.json"));
  process.stdout.write(`${JSON.stringify({ event: "heartbeat", replicate, elapsedSeconds, m1Green, load: command("/usr/bin/uptime") })}\n`);
  if (!m1Green && Date.now() - startMillis >= M1_DEADLINE_MS && !terminationReason) {
    terminationReason = "m1-deadline";
    signalGroup(child, "SIGINT");
    escalationTimer = setTimeout(() => signalGroup(child, "SIGTERM"), 10_000);
  } else if (Date.now() - startMillis >= CELL_CAP_MS && !terminationReason) {
    terminationReason = "whole-cell-cap";
    signalGroup(child, "SIGINT");
    escalationTimer = setTimeout(() => signalGroup(child, "SIGTERM"), 10_000);
  }
}, 5_000);

const outcome = await new Promise((resolvePromise, rejectPromise) => {
  child.once("error", rejectPromise);
  child.once("exit", (code, signal) => resolvePromise({ code, signal }));
});

clearInterval(heartbeat);
if (escalationTimer) clearTimeout(escalationTimer);
closeSync(stdoutFd);
closeSync(stderrFd);
const finishedAt = new Date();
const terminal = {
  schemaVersion: "snapback2-loop-cell-terminal.v1",
  replicate,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  elapsedSeconds: (finishedAt.getTime() - startMillis) / 1000,
  exitCode: outcome.code,
  signal: outcome.signal,
  terminationReason,
  m1GreenMarkerPresent: existsSync(join(evidenceRoot, "m1-green.json")),
  runSummaryPresent: existsSync(join(appRoot, "run-summary.json")),
  finalLoad: command("/usr/bin/uptime"),
};
json(join(cellRoot, "controller-terminal.json"), terminal, "wx");
process.stdout.write(`${JSON.stringify({ event: "terminal", ...terminal })}\n`);
process.exit(outcome.code === 0 && terminationReason === null ? 0 : 1);
