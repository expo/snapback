#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function formatSeconds(value) {
  return value === null || value === undefined ? "not recorded" : `${value}s`;
}

function formatTokens(value) {
  return value === null || value === undefined ? "not recorded" : String(value);
}

export function projectMechanicalAggregates(record, sourceSha256) {
  if (!record || Array.isArray(record) || typeof record !== "object") throw new TypeError("run record must be an object");
  const extension = record.socialMessenger;
  if (!extension || typeof extension !== "object") throw new Error("run record lacks socialMessenger extension");
  const milestones = Object.entries(extension.milestones ?? {}).map(([id, milestone]) => ({
    id,
    status: milestone.status ?? "not-run",
    wallSeconds: milestone.authoring?.wallSeconds ?? null,
    inputTokens: milestone.authoring?.tokens?.input ?? null,
    outputTokens: milestone.authoring?.tokens?.output ?? null,
    firstGreenAt: milestone.authoring?.firstGreenAt ?? null,
  }));
  const projection = {
    schemaVersion: "social-messenger.mechanical-aggregates.v1",
    sourceSha256,
    lane: record.lane ?? null,
    laneVariant: record.laneVariant ?? null,
    harness: record.harness ?? null,
    instrumentVersion: extension.instrumentVersion ?? null,
    timestamps: record.timestamps ?? null,
    totalWallSeconds: record.wallClock?.totalSeconds ?? null,
    totalTokens: {
      input: record.tokens?.input ?? null,
      output: record.tokens?.output ?? null,
    },
    correctionLoopCount: Array.isArray(record.correctionLoops) ? record.correctionLoops.length : null,
    milestones,
    setup: extension.setup ?? null,
    scaleReplay: extension.scaleReplay ?? null,
  };
  const rows = milestones.map((milestone) =>
    `| ${milestone.id} | ${milestone.status} | ${formatSeconds(milestone.wallSeconds)} | ${formatTokens(milestone.inputTokens)} | ${formatTokens(milestone.outputTokens)} |`,
  );
  const sourceLine = `Generated from run-record SHA-256 \`${sourceSha256}\`; do not hand-edit.`;
  const table = [
    "| Milestone | Status | Authoring wall | Input tokens | Output tokens |",
    "| --- | --- | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
  return {
    projection,
    runMarkdown: [
      "<!-- social-messenger mechanical aggregate -->",
      sourceLine,
      "",
      `Total wall: ${formatSeconds(projection.totalWallSeconds)}. Correction loops: ${projection.correctionLoopCount ?? "not recorded"}.`,
      "",
      table,
      "",
    ].join("\n"),
    diaryMarkdown: [
      "<!-- social-messenger diary mechanical aggregate -->",
      sourceLine,
      "",
      table,
      "",
      "Qualitative diary narrative belongs below this generated block.",
      "",
    ].join("\n"),
  };
}

function parseArgs(argv) {
  const options = { record: null, runOut: null, diaryOut: null, projectionOut: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--") && options.record === null) options.record = arg;
    else if (arg === "--run-out") options.runOut = argv[++index];
    else if (arg === "--diary-out") options.diaryOut = argv[++index];
    else if (arg === "--projection-out") options.projectionOut = argv[++index];
    else throw new Error(`unknown aggregate option: ${arg}`);
  }
  if (!options.record || !options.runOut || !options.diaryOut) {
    throw new Error("usage: generate-aggregates.mjs <record.json> --run-out <path> --diary-out <path> [--projection-out <path>]");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bytes = await readFile(resolve(options.record));
  const sourceSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const result = projectMechanicalAggregates(JSON.parse(bytes), sourceSha256);
  await Promise.all([
    writeFile(resolve(options.runOut), result.runMarkdown),
    writeFile(resolve(options.diaryOut), result.diaryMarkdown),
    ...(options.projectionOut
      ? [writeFile(resolve(options.projectionOut), `${JSON.stringify(result.projection, null, 2)}\n`)]
      : []),
  ]);
  process.stdout.write(`social-messenger aggregates: generated run+diary from ${sourceSha256}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
