#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { armStatus } from "./arm-matrix.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");
const requiredReports = [
  "reports/calibration-report.md",
  "reports/calibration-remediation.v1.json",
  "reports/deep-round-report.md",
  "reports/deep-remediation.v1.json",
  "reports/final-ratings.v1.json",
  "reports/final-scoring.v1.json",
  "reports/final-report.md",
  "reports/completion-audit.v1.json",
];

// @ref LLP 0102#deliverables — file presence is not completion; all 35
// capsules and a requirement-by-requirement completion audit remain mandatory.
async function exists(relative) {
  try {
    await access(path.join(bakeoffRoot, relative));
    return true;
  } catch {
    return false;
  }
}

export function summarizeProgram({ health, freeze, arms, reportPresence, completionAuditVerified = false }) {
  const armCounts = Object.fromEntries([...new Set(arms.map((arm) => arm.state))]
    .sort()
    .map((state) => [state, arms.filter((arm) => arm.state === state).length]));
  const attemptedStates = new Set(["complete", "timeboxed", "stopped"]);
  const calibration = arms.filter((arm) => arm.round === "calibration");
  const deep = arms.filter((arm) => arm.round === "deep");
  const missingReports = Object.entries(reportPresence)
    .filter(([, present]) => !present)
    .map(([relative]) => relative);
  const stage0Complete = health.readyForTimedArms === true && freeze.readinessAtFreeze === "ready";
  const calibrationComplete = calibration.length === 14 && calibration.every((arm) => attemptedStates.has(arm.state));
  const deepComplete = deep.length === 21 && deep.every((arm) => attemptedStates.has(arm.state));
  const allArmsAttempted = arms.length === 35 && arms.every((arm) => attemptedStates.has(arm.state));
  const reportsComplete = missingReports.length === 0;
  return {
    schemaVersion: 1,
    stages: {
      freeze: stage0Complete ? "complete" : "in-progress",
      calibration: calibrationComplete ? "complete" : "pending",
      remediation1: reportPresence["reports/calibration-remediation.v1.json"] ? "artifact-present-unverified" : "pending",
      deepRound: deepComplete ? "complete" : "pending",
      remediation2: reportPresence["reports/deep-remediation.v1.json"] ? "artifact-present-unverified" : "pending",
      finalConfirmationAndRanking: reportsComplete && allArmsAttempted ? "artifact-present-unverified" : "pending",
    },
    stage0: {
      credentialsReady: health.readyForTimedArms,
      freezeReadiness: freeze.readinessAtFreeze,
    },
    arms: {
      total: arms.length,
      counts: armCounts,
      allAttempted: allArmsAttempted,
    },
    reports: {
      missing: missingReports,
      completionAuditVerified,
    },
    artifactSetComplete: stage0Complete && allArmsAttempted && reportsComplete,
    complete: stage0Complete && allArmsAttempted && reportsComplete && completionAuditVerified,
  };
}

async function main() {
  const [health, freeze, arms] = await Promise.all([
    readFile(path.join(bakeoffRoot, "protocol", "credentials-health.v1.json"), "utf8").then(JSON.parse),
    readFile(path.join(bakeoffRoot, "protocol", "freeze.v2.json"), "utf8").then(JSON.parse),
    armStatus(),
  ]);
  const reportPresence = Object.fromEntries(await Promise.all(requiredReports.map(async (relative) => [relative, await exists(relative)])));
  const completionAudit = await readFile(path.join(bakeoffRoot, "reports", "completion-audit.v1.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  const completionAuditVerified = completionAudit?.schemaVersion === 1 &&
    completionAudit?.allRequirementsVerified === true &&
    completionAudit?.protocolAggregateSha256 === freeze.aggregateSha256 &&
    completionAudit?.armCount === 35 &&
    Array.isArray(completionAudit?.requirements) &&
    completionAudit.requirements.length > 0 &&
    completionAudit.requirements.every((item) =>
      item.status === "verified" && Array.isArray(item.evidencePaths) && item.evidencePaths.length > 0);
  console.log(JSON.stringify(summarizeProgram({
    health,
    freeze,
    arms,
    reportPresence,
    completionAuditVerified,
  }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
