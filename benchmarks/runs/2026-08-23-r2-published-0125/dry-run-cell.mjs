#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { validateSocialMessengerRunRecord } from "../../tools/social-messenger/record-validator.mjs";

const execFileAsync = promisify(execFile);
const runRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(runRoot, "../../..");

function duration(argv) {
  const index = argv.indexOf("--duration-seconds");
  const value = index === -1 ? 120 : Number(argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--duration-seconds must be a positive integer");
  }
  return value;
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function logical(root, path) {
  return relative(root, path).split(sep).join("/");
}

async function artifactInventory(root, directory = root) {
  const inventory = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      inventory.push(...await artifactInventory(root, path));
    } else if (entry.isFile() && entry.name !== "validation.json") {
      const bytes = await readFile(path);
      inventory.push({
        path: logical(root, path),
        bytes: (await stat(path)).size,
        sha256: sha256(bytes),
      });
    }
  }
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const argv = process.argv.slice(2);
  const durationSeconds = duration(argv);
  const failureProbe = argv.includes("--failure-probe");
  const requestedRoot = argument(argv, "--output-root");
  let root;
  if (requestedRoot === null) {
    root = await mkdtemp(join(tmpdir(), "snapback-r2-dry-run-"));
  } else {
    root = resolve(requestedRoot);
    await mkdir(dirname(root), { recursive: true });
    await mkdir(root);
  }
  const privateExecutionRoot = join(root, "execution");
  const configPath = join(root, "harness-config.json");
  const driverPath = join(runRoot, "dry-run-driver.mjs");
  const controllerPath = join(
    repositoryRoot,
    "benchmarks/tools/social-messenger/metering/lane-controller.mjs",
  );
  const config = {
    schemaVersion: "snapback.r2-harness-config.v1",
    runId: `dry-run-${Date.now()}`,
    paths: { privateExecutionRoot },
    execution: {
      milestones: ["M1", "M2", "M3"],
      perMilestoneWallSafetyLimitSeconds: Math.max(300, durationSeconds + 60),
      loadIsolation: {
        sampleEverySeconds: 1,
        ceilingInclusive: { loadavg1: 1_000_000, loadavg5: 1_000_000, loadavg15: 1_000_000 },
      },
    },
    pins: { instrument: { instrumentPin: "social-messenger@0.3.3-m8" } },
    harnesses: {
      "dry-run-stub": {
        binary: process.execPath,
        observedVersion: process.version,
        promptDelivery: "stdin",
      },
    },
    cells: [{
      id: "dry-run-noop",
      harness: "dry-run-stub",
      model: "none",
      effort: null,
      app: "DryRun",
      profile: "none",
      promptFile: "none",
      ports: [0, 0],
      dryRunDurationSeconds: durationSeconds,
      failBeforeChoreography: failureProbe,
    }],
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  let stdout = "";
  let stderr = "";
  let controllerFailed = false;
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [
      controllerPath,
      "--harness-config",
      configPath,
      "--cell",
      "dry-run-noop",
      "--driver",
      driverPath,
    ], { cwd: repositoryRoot, timeout: (durationSeconds + 45) * 1_000 }));
  } catch (error) {
    if (!failureProbe) throw error;
    controllerFailed = true;
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
  }
  if (failureProbe !== controllerFailed) {
    throw new Error(
      failureProbe
        ? "failure probe unexpectedly exited successfully"
        : "successful dry-run unexpectedly failed",
    );
  }
  const cellRoot = join(privateExecutionRoot, "cells", "dry-run-noop");
  const recordPath = join(cellRoot, "record.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const [baseSchema, extensionSchema, composedSchema] = await Promise.all([
    "benchmarks/schema/run-record.schema.json",
    "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    "benchmarks/schema/social-messenger/run-record.schema.json",
  ].map(async (path) => JSON.parse(await readFile(join(repositoryRoot, path), "utf8"))));
  const errors = validateSocialMessengerRunRecord(composedSchema, record, {
    schemas: [baseSchema, extensionSchema],
    artifactRoot: cellRoot,
  });
  if (errors.length > 0) throw new Error(`dry-run record failed validation: ${errors.join("; ")}`);
  const controller = controllerFailed
    ? { failedAsRequested: true }
    : JSON.parse(stdout.trim());
  const schemaPaths = {
    base: "benchmarks/schema/run-record.schema.json",
    extension: "benchmarks/schema/social-messenger/run-record-extension.schema.json",
    composed: "benchmarks/schema/social-messenger/run-record.schema.json",
    semantic: "benchmarks/tools/social-messenger/record-validator.mjs",
  };
  const disposition = {
    schemaVersion: "snapback.r2-dry-run-validation.v1",
    ok: true,
    durationSeconds,
    failureProbe,
    controller,
    stderr: stderr.trim(),
    cellRoot: logical(root, cellRoot),
    record: {
      path: logical(root, recordPath),
      sha256: sha256(await readFile(recordPath)),
    },
    status: record.socialMessenger.milestones.M1.status,
    scorecardEligible: record.socialMessenger.efficiencyScorecardEligibility.eligible,
    noModelCellStarted: true,
    validator: {
      errors,
      sources: Object.fromEntries(await Promise.all(
        Object.entries(schemaPaths).map(async ([name, path]) => [
          name,
          { path, sha256: sha256(await readFile(join(repositoryRoot, path))) },
        ]),
      )),
    },
    artifacts: await artifactInventory(root),
  };
  const validationPath = join(root, "validation.json");
  await writeFile(validationPath, `${JSON.stringify(disposition, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ...disposition,
    evidenceRoot: root,
    recordPath,
    validationPath,
    validationSha256: sha256(await readFile(validationPath)),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`R2_DRY_RUN_FAILED: ${error.message}\n`);
  process.exitCode = 2;
});
