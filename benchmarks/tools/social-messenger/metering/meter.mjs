#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

import { adaptAdvisoryFamily } from "./adapters/advisory.mjs";
import { adaptClaudeSession } from "./adapters/claude-session.mjs";
import { adaptCodexSession } from "./adapters/codex-session.mjs";
import {
  mergeBoundaryMaps,
  readBoundaryFile,
  readReceiptBoundaryFiles,
} from "./boundaries.mjs";
import { joinUsageToMilestones } from "./joiner.mjs";
import { parseJsonLines } from "./jsonl.mjs";
import { assertCapFamily } from "./sources.mjs";

const USAGE = `Usage:
  node meter.mjs --cap-family <family> --adapter <claude|codex|advisory>
    [--session <session.jsonl>] [--receipts <receipts-mN.jsonl> ...]
    [--boundaries <boundaries.json>] [--first-product-edit <marker.json>]
    [--out <metering.json>]

The emitted milestones object is a run-record-extension patch. Copy source to
the base run record's tokens.source, merge milestones.*.authoring, and copy
firstProductEdit to the socialMessenger extension.`;

function parseArgs(argv) {
  const options = { receiptPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--cap-family") options.capFamily = next();
    else if (arg === "--adapter") options.adapter = next();
    else if (arg === "--session") options.sessionPath = next();
    else if (arg === "--receipts") options.receiptPaths.push(next());
    else if (arg === "--boundaries") options.boundaryPath = next();
    else if (arg === "--first-product-edit") options.firstProductEditPath = next();
    else if (arg === "--out") options.outPath = next();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function loadChannel(options) {
  assertCapFamily(options.capFamily);
  if (options.adapter === "advisory") {
    return adaptAdvisoryFamily(options.capFamily);
  }
  if (options.adapter === "claude" && !["claude-frontier", "mid-tier"].includes(options.capFamily)) {
    throw new Error(`Claude adapter is not approved for ${options.capFamily}`);
  }
  if (options.adapter === "codex" && options.capFamily !== "gpt-frontier") {
    throw new Error(`Codex adapter is not approved for ${options.capFamily}`);
  }
  if (!options.sessionPath) throw new Error("--session is required for native adapters");
  const records = parseJsonLines(
    await readFile(options.sessionPath, "utf8"),
    options.sessionPath,
  );
  if (options.adapter === "claude") return adaptClaudeSession(records);
  if (options.adapter === "codex") return adaptCodexSession(records);
  throw new Error("--adapter must be claude, codex, or advisory");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!options.capFamily || !options.adapter) throw new Error(USAGE);
  const maps = [];
  if (options.receiptPaths.length > 0) {
    maps.push(await readReceiptBoundaryFiles(options.receiptPaths));
  }
  if (options.boundaryPath) maps.push(await readBoundaryFile(options.boundaryPath));
  if (maps.length === 0) throw new Error("at least one --receipts or --boundaries input is required");
  const firstProductEdit = options.firstProductEditPath
    ? JSON.parse(await readFile(options.firstProductEditPath, "utf8"))
    : null;
  const result = joinUsageToMilestones({
    channel: await loadChannel(options),
    boundaries: mergeBoundaryMaps(...maps),
    firstProductEdit,
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outPath) await writeFile(options.outPath, output);
  else process.stdout.write(output);
}

main().catch((error) => {
  process.stderr.write(`social-messenger metering: ${error.message}\n`);
  process.exitCode = 2;
});
