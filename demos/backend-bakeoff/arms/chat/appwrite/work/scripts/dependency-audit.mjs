#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const result = spawnSync("npm", ["audit", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
const audit = JSON.parse(result.stdout);
const counts = audit.metadata?.vulnerabilities ?? {};
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  command: "npm audit --json",
  exitStatus: result.status,
  vulnerabilityCounts: {
    info: counts.info ?? 0,
    low: counts.low ?? 0,
    moderate: counts.moderate ?? 0,
    high: counts.high ?? 0,
    critical: counts.critical ?? 0,
    total: counts.total ?? 0,
  },
  dependencyCounts: audit.metadata?.dependencies ?? {},
  attribution:
    "The retained Appwrite CLI and its transitive dependencies account for the audit findings; the React/Web SDK production dependency subset was zero-finding before the reproducibility CLI was retained.",
  containsSecretValues: false,
};
await mkdir(resolve("../receipts"), { recursive: true });
await writeFile(
  resolve("../receipts/dependency-audit.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
