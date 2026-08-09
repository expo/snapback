#!/usr/bin/env node
// Probe-set custody tool (LLP 0201 D3.5): sha256 commitment before a
// wave's first lane starts, verification against the published file
// after the wave. The rotation log (rotation-log.md, alongside) is the
// custody record; the same hash also lands in the wave record.
//
//   node commit-probes.mjs commit <probe-set-file> <wave-id>
//   node commit-probes.mjs verify <file> <sha256>

import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "rotation-log.md");

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function usage(code) {
  console.error(
    "usage:\n" +
      "  commit-probes.mjs commit <probe-set-file> <wave-id>\n" +
      "  commit-probes.mjs verify <file> <sha256>"
  );
  process.exit(code);
}

const [cmd, fileArg, extra] = process.argv.slice(2);
if (!cmd || !fileArg) usage(2);
if (!existsSync(fileArg)) {
  console.error(`error: no such file: ${fileArg}`);
  process.exit(2);
}

if (cmd === "commit") {
  if (!extra) usage(2);
  const wave = extra;
  const hash = sha256(fileArg);
  const date = new Date().toISOString().slice(0, 10);
  // Category-mapping and published-path cells start empty; they are
  // filled by hand when the wave publishes its probe set.
  const row = `| ${date} | ${wave} | ${basename(fileArg)} | \`${hash}\` | *(unpublished — wave open)* | *(fill at publication)* |\n`;
  appendFileSync(LOG, row);
  console.log(`sha256(${fileArg}) = ${hash}`);
  console.log(`committed for wave ${wave}; row appended to ${LOG}`);
  console.log("record the same hash in the wave record before the wave's first lane starts.");
} else if (cmd === "verify") {
  if (!extra) usage(2);
  const expected = extra.toLowerCase();
  const actual = sha256(fileArg);
  if (actual === expected) {
    console.log(`OK: ${fileArg} matches ${expected}`);
  } else {
    console.error(`MISMATCH: ${fileArg}\n  expected ${expected}\n  actual   ${actual}`);
    process.exit(1);
  }
} else {
  usage(2);
}
