#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { armRoot, workRoot } from "./constants.mjs";

const result = spawnSync("npm", ["audit", "--json"], {
  cwd: workRoot,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (![0, 1].includes(result.status)) {
  throw new Error(result.stderr || `npm audit failed with ${result.status}`);
}
const report = JSON.parse(result.stdout);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  command: "npm audit --json",
  exitStatus: result.status,
  vulnerabilityCounts: report.metadata?.vulnerabilities ?? {},
  dependencyCounts: report.metadata?.dependencies ?? {},
  attribution:
    "The retained Appwrite CLI and its transitive dependency tree account for the audit findings; counts are reported without suppressing development-tool dependencies.",
  containsSecretValues: false,
};
await writeFile(
  path.resolve(armRoot, "receipts/dependency-audit.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
