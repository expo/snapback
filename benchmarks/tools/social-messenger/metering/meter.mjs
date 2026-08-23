#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

import { joinUsageToMilestones } from "./joiner.mjs";
import { loadMeteringManifest } from "./manifest.mjs";

const USAGE = `Usage:
  node meter.mjs --manifest <driver-stamped-lane-manifest.json>
    [--out <metering.json>]

The emitted milestones object is a run-record-extension patch. Copy source to
the base run record's tokens.source, merge milestones.*.authoring, and copy
instrumentVersion, observabilityProtocol, efficiencyScorecardEligibility, firstProductEdit,
meteringProvenance, and suiteStatusLinkage to the socialMessenger extension.
Native adapters only accept the complete, hash-bound builder session tree
declared by the lane manifest.`;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--manifest") options.manifestPath = next();
    else if (arg === "--out") options.outPath = next();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!options.manifestPath) throw new Error(USAGE);
  const input = await loadMeteringManifest(options.manifestPath);
  const result = joinUsageToMilestones({
    ...input,
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outPath) await writeFile(options.outPath, output);
  else process.stdout.write(output);
}

main().catch((error) => {
  process.stderr.write(`social-messenger metering: ${error.message}\n`);
  process.exitCode = 2;
});
