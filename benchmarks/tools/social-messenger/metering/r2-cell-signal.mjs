#!/usr/bin/env node

import { appendFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function fail(message) {
  throw new Error(`R2_CELL_SIGNAL_INVALID: ${message}`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    index += 1;
    if (index >= argv.length) fail(`${key} requires a value`);
    options[key.replace(/^--/u, "")] = argv[index];
  }
  return options;
}

function inside(root, path) {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function retainedPath(root, value, label, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    fail(`${label} must be a non-empty cell-relative path`);
  }
  const path = resolve(root, value);
  if (!inside(root, path)) fail(`${label} escapes the cell root`);
  const status = await lstat(path).catch(() => null);
  if (!status?.isFile() || status.isSymbolicLink()) fail(`${label} is not a retained regular file`);
  await readFile(path);
  return relative(root, path).split(sep).join("/");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root ?? fail("--root is required"));
  const milestone = options.milestone?.toUpperCase();
  if (!/^M[1-8]$/u.test(milestone ?? "")) fail("--milestone must name M1 through M8");
  if (!new Set(["green", "capability-failure", "aborted"]).has(options.status)) {
    fail("--status must be green, capability-failure, or aborted");
  }
  const terminalReason = options["terminal-reason"];
  const allowedReason = {
    green: ["green"],
    "capability-failure": ["wall-cap", "token-cap"],
    aborted: ["abort"],
  }[options.status];
  if (!allowedReason.includes(terminalReason)) fail("terminal reason contradicts status");
  const marker = {
    milestone,
    status: options.status,
    terminalReason,
    recordedAt: new Date().toISOString(),
    suiteStatus: await retainedPath(root, options["suite-status"], "suite status"),
    suiteObservations: await retainedPath(
      root,
      options["suite-observations"],
      "suite observations",
      { optional: options.status !== "green" },
    ),
    choreographyReceipt: await retainedPath(
      root,
      options["choreography-receipt"],
      "choreography receipt",
      { optional: options.status !== "green" },
    ),
    choreographyObservations: await retainedPath(
      root,
      options["choreography-observations"],
      "choreography observations",
      { optional: options.status !== "green" },
    ),
  };
  await mkdir(resolve(root, "events"), { recursive: true });
  await appendFile(resolve(root, "events/cell-milestones.jsonl"), `${JSON.stringify(marker)}\n`);
  const next = `M${Number(milestone.slice(1)) + 1}`;
  if (next === "M4") return;
  while (true) {
    try {
      await readFile(resolve(root, "gates", next));
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
