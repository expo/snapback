#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

async function main() {
  const argv = process.argv.slice(2);
  const durationSeconds = duration(argv);
  const failureProbe = argv.includes("--failure-probe");
  const root = await mkdtemp(join(tmpdir(), "snapback-r2-dry-run-"));
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
  process.stdout.write(`${JSON.stringify({
    ok: true,
    durationSeconds,
    controller: controllerFailed
      ? { failedAsRequested: true }
      : JSON.parse(stdout.trim()),
    stderr: stderr.trim(),
    cellRoot,
    recordPath,
    status: record.socialMessenger.milestones.M1.status,
    failureProbe,
    scorecardEligible: record.socialMessenger.efficiencyScorecardEligibility.eligible,
    noModelCellStarted: true,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`R2_DRY_RUN_FAILED: ${error.message}\n`);
  process.exitCode = 2;
});
