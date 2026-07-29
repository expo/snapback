#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const classifications = new Set(["defect", "capability", "experience", "docs-diagnostics", "operations", "benchmark-only"]);
const destinations = new Set(["immediate-fix", "filesystem-issue", "existing-llp", "new-llp", "deliberate-non-goal"]);
const decisions = new Set(["accept", "defer", "refuse", "investigate"]);
const statuses = new Set(["proposed", "in-progress", "landed", "verified", "deferred", "refused"]);
const apps = new Set(["todo", "chat", "linear", "partiful", "research-room"]);
const competitors = new Set(["convex", "supabase", "firebase", "instantdb", "spacetimedb", "appwrite"]);

// @ref LLP 0102#snapback-improvement-synthesis — remediation must preserve
// source evidence, the competitor outcome, a Snapback-native outcome, and its
// own before/after acceptance witness.
export function verifyLedger(ledger) {
  const problems = [];
  const require = (condition, message) => {
    if (!condition) problems.push(message);
  };
  require(ledger?.schemaVersion === 1, "schemaVersion must be 1");
  require(ledger?.tranche === "calibration" || ledger?.tranche === "deep-round", "invalid tranche");
  require(/^[0-9a-f]{40}$/.test(ledger?.startingSnapbackCommit ?? ""), "starting Snapback commit must be full sha");
  require(Array.isArray(ledger?.entries), "entries must be an array");
  const ids = (ledger?.entries ?? []).map((entry) => entry.id);
  require(new Set(ids).size === ids.length, "remediation ids must be unique");
  for (const entry of ledger?.entries ?? []) {
    const prefix = entry.id ?? "<missing-id>";
    require(/^SB-[0-9]{3}$/.test(prefix), `${prefix}: invalid id`);
    for (const field of [
      "title",
      "competitorOutcome",
      "snapbackPropertyToPreserve",
      "snapbackNativeOutcome",
      "acceptanceWitness",
    ]) {
      require(typeof entry[field] === "string" && entry[field].trim().length > 0, `${prefix}: ${field} required`);
    }
    require(Array.isArray(entry.sourceApps) && entry.sourceApps.length > 0 &&
      entry.sourceApps.every((app) => apps.has(app)), `${prefix}: invalid source apps`);
    require(Array.isArray(entry.backendComparisons) && entry.backendComparisons.length > 0 &&
      entry.backendComparisons.every((provider) => competitors.has(provider)), `${prefix}: invalid backend comparisons`);
    require(Array.isArray(entry.evidencePaths) && entry.evidencePaths.length > 0, `${prefix}: evidence required`);
    require(Number.isInteger(entry.frequency) && entry.frequency >= 1, `${prefix}: frequency must be positive integer`);
    require(classifications.has(entry.classification), `${prefix}: invalid classification`);
    require(destinations.has(entry.destination), `${prefix}: invalid destination`);
    require(decisions.has(entry.decision), `${prefix}: invalid decision`);
    require(statuses.has(entry.status), `${prefix}: invalid status`);
    if (entry.status === "refused") require(entry.decision === "refuse", `${prefix}: refused status requires refuse decision`);
    if (entry.status === "deferred") require(entry.decision === "defer", `${prefix}: deferred status requires defer decision`);
    if (entry.status === "landed" || entry.status === "verified") {
      require(/^[0-9a-f]{40}$/.test(entry.endingSnapbackCommit ?? ""), `${prefix}: landed/verified entry requires ending commit`);
      require(Array.isArray(entry.beforeEvidencePaths) && entry.beforeEvidencePaths.length > 0,
        `${prefix}: landed/verified entry requires before evidence`);
      require(Array.isArray(entry.afterEvidencePaths) && entry.afterEvidencePaths.length > 0,
        `${prefix}: landed/verified entry requires after evidence`);
    }
    if (entry.classification === "benchmark-only") {
      require(entry.destination !== "immediate-fix", `${prefix}: benchmark-only finding cannot become an immediate product fix`);
    }
  }
  return problems;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("usage: node scripts/remediation-ledger.mjs <ledger.json>");
  const ledger = JSON.parse(await readFile(path.resolve(process.cwd(), inputPath), "utf8"));
  const problems = verifyLedger(ledger);
  if (problems.length > 0) {
    console.error(JSON.stringify({ ok: false, problems }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, entries: ledger.entries.length }, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
