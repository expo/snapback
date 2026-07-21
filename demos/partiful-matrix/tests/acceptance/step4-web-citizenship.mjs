#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acceptanceRoot,
  exactArtifactIdentity,
  exactRoot,
  gitRevision,
  identity,
  writeStep4Report,
} from './step4-closure-helpers.mjs';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// consume Exact's governed LLP 0211 device matrix as the residual Partitime
// production-web gate; partial or missing rows remain red rather than skipped.

const output = `${acceptanceRoot}/results/step4-web-citizenship.json`;
const exactReportPath = 'docs/reports/web-citizenship-ime-forms.json';
const exactValidatorPath = 'scripts/check-web-citizenship-ime-forms.mjs';
const generatorPath = 'demos/partiful-matrix/tests/acceptance/step4-web-citizenship.mjs';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function key(environment, assertion) {
  return `${environment}:${assertion}`;
}

function localEvidenceIdentity(evidence) {
  const ref = evidence.ref.split('#', 1)[0];
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    return { kind: evidence.kind, ref: evidence.ref, external: true };
  }
  const absolute = resolve(exactRoot, ref);
  if (!existsSync(absolute)) return null;
  return { kind: evidence.kind, ref: evidence.ref, artifact: exactArtifactIdentity(ref) };
}

export function auditCitizenshipReport(report) {
  const structuralFailures = [];
  if (!isRecord(report)) throw new Error('Exact citizenship report root must be an object');
  if (report.schemaVersion !== 1) structuralFailures.push('schema-version-mismatch');
  if (!nonEmpty(report.provenance?.authority) || !report.provenance.authority.includes('LLP 0211')) {
    structuralFailures.push('authority-missing');
  }

  const required = new Map();
  for (const entry of Array.isArray(report.requiredResults) ? report.requiredResults : []) {
    if (!nonEmpty(entry?.environment) || !nonEmpty(entry?.assertion)) {
      structuralFailures.push('malformed-required-result');
      continue;
    }
    const id = key(entry.environment, entry.assertion);
    if (required.has(id)) structuralFailures.push(`duplicate-required-result:${id}`);
    required.set(id, entry);
  }
  if (required.size === 0) structuralFailures.push('required-result-inventory-empty');

  const environmentPairs = new Set();
  for (const environment of Array.isArray(report.requiredEnvironments) ? report.requiredEnvironments : []) {
    for (const assertion of Array.isArray(environment?.assertions) ? environment.assertions : []) {
      environmentPairs.add(key(environment.id, assertion));
    }
  }
  for (const id of required.keys()) {
    if (!environmentPairs.has(id)) structuralFailures.push(`required-result-not-in-environment-matrix:${id}`);
  }
  for (const id of environmentPairs) {
    if (!required.has(id)) structuralFailures.push(`environment-matrix-row-not-required:${id}`);
  }

  const observed = new Map();
  for (const result of Array.isArray(report.results) ? report.results : []) {
    if (!nonEmpty(result?.environment) || !nonEmpty(result?.assertion)) {
      structuralFailures.push('malformed-observed-result');
      continue;
    }
    const id = key(result.environment, result.assertion);
    if (observed.has(id)) structuralFailures.push(`duplicate-observed-result:${id}`);
    observed.set(id, result);
  }

  const rows = [...required.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, expected]) => {
    const result = observed.get(id);
    const issues = [];
    if (!result) issues.push('evidence-missing');
    if (result && !expected.acceptedFixtures?.includes(result.fixture)) issues.push('fixture-not-accepted');
    if (result && result.status !== 'passed') issues.push('result-not-passed');
    if (result && !nonEmpty(result.notes)) issues.push('notes-missing');
    const evidence = Array.isArray(result?.evidence)
      ? result.evidence.filter((entry) => nonEmpty(entry?.kind) && nonEmpty(entry?.ref))
      : [];
    if (result && evidence.length === 0) issues.push('evidence-reference-missing');
    const evidenceIdentities = evidence.map(localEvidenceIdentity);
    if (evidenceIdentities.some((entry) => entry === null)) issues.push('local-evidence-artifact-missing');
    return {
      id,
      environment: expected.environment,
      assertion: expected.assertion,
      acceptedFixtures: expected.acceptedFixtures,
      status: issues.length === 0 ? 'pass' : 'red',
      issues,
      ...(result
        ? {
            fixture: result.fixture,
            notes: result.notes,
            evidence: evidenceIdentities.filter(Boolean),
          }
        : {}),
    };
  });

  if (report.status === 'passed') {
    for (const field of ['id', 'operator', 'baseCommit', 'startedAt', 'completedAt']) {
      if (!nonEmpty(report.run?.[field])) structuralFailures.push(`run-${field}-missing`);
    }
  }
  for (const id of observed.keys()) {
    if (!required.has(id)) structuralFailures.push(`unexpected-observed-result:${id}`);
  }
  return { rows, structuralFailures };
}

export function buildCitizenshipReceipt(report) {
  const { rows, structuralFailures } = auditCitizenshipReport(report);
  const passed = rows.filter(({ status }) => status === 'pass').length;
  const red = rows.length - passed;
  const claimSatisfied = report.status === 'passed' && structuralFailures.length === 0 && red === 0;
  return {
    schemaVersion: 'partitime.step4-web-citizenship.v1',
    claimId: 'STEP4.WEB_CITIZENSHIP',
    auditCompleted: true,
    ok: claimSatisfied,
    claimSatisfied,
    outcome: claimSatisfied ? 'pass' : 'red',
    skipPolicy: 'forbidden',
    skipped: 0,
    recordedAt: new Date().toISOString(),
    repository: {
      snapbackRevision: gitRevision(),
      exactRevision: gitRevision(exactRoot),
    },
    inputs: {
      exactReport: exactArtifactIdentity(exactReportPath),
      exactValidator: exactArtifactIdentity(exactValidatorPath),
      generator: identity(generatorPath),
    },
    sourceStatus: report.status ?? 'missing',
    sourceRun: report.run ?? null,
    summary: { passed, red, total: rows.length, structuralFailures: structuralFailures.length },
    rows,
    structuralFailures,
    nonClaims: [
      'This receipt consumes Exact LLP 0211 evidence; it does not replace or synthesize a browser/device run.',
      'Passing partial desktop evidence does not satisfy the residual production-web matrix.',
    ],
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(readFileSync(resolve(exactRoot, exactReportPath), 'utf8'));
  writeStep4Report(output, buildCitizenshipReceipt(report));
}
