#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODEGEN_JOBS } from '../../../scripts/generated-artifact-policy.mjs';
import { suggestDeclarations } from '../declaration-suggestion.mjs';
import { generate } from '../index.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const STATUS_KEYS = Object.freeze(['exact', 'schema-derived', 'widened', 'holed', 'refused']);
const EVIDENCE_CLASS_KEYS = Object.freeze(['runtime-witnessed']);
const DELIBERATE_NEGATIVE_FIXTURES = Object.freeze([]);

function slash(path) {
  return path.split(sep).join('/');
}

function sourceInventory(backend) {
  const inventory = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'generated' || entry.name.startsWith('generated-') || entry.name === 'node_modules' || entry.name === '.snapback') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        inventory.push([
          slash(relative(backend, path)),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        ]);
      }
    }
  };
  visit(backend);
  return inventory;
}

function emptyCounts() {
  return Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
}

function proportions(counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(STATUS_KEYS.map((key) => [key, total === 0 ? 0 : counts[key] / total]));
}

function emptyEvidenceClassCounts() {
  return Object.fromEntries(EVIDENCE_CLASS_KEYS.map((key) => [key, {
    candidateSuggestions: 0,
    receipts: 0,
    notClaimedReceipts: 0,
    additions: 0,
    pathWitnesses: 0,
  }]));
}

function countEvidenceClasses(suggestions) {
  const counts = emptyEvidenceClassCounts();
  const runtimeReceiptsByDigest = new Map();
  for (const suggestion of suggestions) {
    const additions = suggestion.dependencyChanges?.additions ?? [];
    const runtimeAdditions = additions.filter((addition) => (
      addition.evidence.some(({ evidenceClass }) => evidenceClass === 'runtime-witnessed')
    ));
    const runtimeReceipts = (suggestion.runtimeEvidenceReceipts ?? []).filter(
      ({ evidenceClass }) => evidenceClass === 'runtime-witnessed',
    );
    if (runtimeAdditions.length > 0) counts['runtime-witnessed'].candidateSuggestions += 1;
    for (const receipt of runtimeReceipts) runtimeReceiptsByDigest.set(receipt.digest, receipt);
    counts['runtime-witnessed'].additions += runtimeAdditions.length;
    counts['runtime-witnessed'].pathWitnesses += runtimeAdditions.reduce(
      (sum, addition) => sum + addition.evidence.filter(
        ({ evidenceClass }) => evidenceClass === 'runtime-witnessed',
      ).length,
      0,
    );
  }
  counts['runtime-witnessed'].receipts = runtimeReceiptsByDigest.size;
  counts['runtime-witnessed'].notClaimedReceipts = [...runtimeReceiptsByDigest.values()].filter(
    ({ aggregate }) => aggregate.status === 'not-claimed',
  ).length;
  return counts;
}

function copyBackendSource(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('generated')) continue;
    cpSync(join(source, entry.name), join(destination, entry.name), { recursive: true });
  }
}

async function prime(job, backend) {
  const options = job.targetProfile ? { targetProfile: job.targetProfile } : {};
  // Always prime a disposable source-equivalent backend. The rollout is a
  // measurement command, so even generated-cache writes must stay outside the
  // repository tree.
  // Keep the disposable mirror below the repository root so codegen's
  // identity-bound local-module policy still recognizes copied shared helpers
  // as reproducible repo sources. The whole mirror is removed after the row.
  const temporaryRoot = mkdtempSync(join(repoRoot, '.snapback-declaration-rollout-'));
  const temporaryBackend = join(temporaryRoot, job.backend);
  copyBackendSource(backend, temporaryBackend);

  // Preserve the bounded repository-relative helper closure used by corpus
  // backends. Keeping the original path depth is what makes imports such as
  // ../../_kit/define.mjs exercise the same source as the real backend.
  if (job.backend.startsWith('demos/')) {
    cpSync(join(repoRoot, 'demos', '_kit'), join(temporaryRoot, 'demos', '_kit'), { recursive: true });
    const temporaryCodegen = join(temporaryRoot, 'packages', 'snapback-codegen');
    mkdirSync(temporaryCodegen, { recursive: true });
    for (const file of ['define.mjs', 'standard-patterns.mjs']) {
      symlinkSync(join(repoRoot, 'packages', 'snapback-codegen', file), join(temporaryCodegen, file));
    }
  }
  if (job.backend === 'demos/browser-local-first/snapback-sessions') {
    copyBackendSource(
      join(repoRoot, 'demos', 'browser-local-first', 'snapback'),
      join(temporaryRoot, 'demos', 'browser-local-first', 'snapback'),
    );
  }
  const appDescriptor = join(dirname(backend), 'demo.snapback.json');
  if (existsSync(appDescriptor)) {
    const temporaryDescriptor = join(temporaryRoot, relative(repoRoot, appDescriptor));
    mkdirSync(dirname(temporaryDescriptor), { recursive: true });
    cpSync(appDescriptor, temporaryDescriptor);
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(temporaryRoot, 'node_modules'), 'dir');
  let generated = await generate(temporaryBackend, options);
  let priming = 'temporary-source-equivalent';
  if (generated.ok === false
    && generated.diagnostics.some(({ code }) => code === 'TRUSTED_COMPOSITION_ACTIVATION_INVALID')) {
    // The rollout measures result declarations, not a retained trusted-
    // composition receipt whose identity drifted because the clone has a new
    // absolute path. Retry with only that optional receipt absent.
    rmSync(join(temporaryBackend, 'trusted-composition-activation.json'), { force: true });
    generated = await generate(temporaryBackend, options);
    priming = 'temporary-without-stale-trusted-composition-activation';
  }
  return {
    backend: temporaryBackend,
    generated,
    priming,
    cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

// Rollouts 2 and 4 share this measurement-only pass. Priming writes generated caches only
// in disposable clones, the before/after inventory makes source immutability
// an executable condition, and this runner never invokes the apply seam.
// @ref LLP 0245#d6-rubber-stamp-resistance-is-visible-not-paternalistic — report every named
// backend separately before aggregating candidate confidence classes.
const uniqueJobs = [];
const seen = new Set();
for (const job of CODEGEN_JOBS) {
  if (seen.has(job.backend) || DELIBERATE_NEGATIVE_FIXTURES.includes(job.backend)) continue;
  seen.add(job.backend);
  uniqueJobs.push(job);
}

const results = [];
for (const job of uniqueJobs) {
  const backend = resolve(repoRoot, job.backend);
  const before = sourceInventory(backend);
  const priorOutbound = process.env.SNAPBACK_OUTBOUND_ACTIONS;
  if (job.outboundActions) process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
  else delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  const primed = await prime(job, backend);
  if (priorOutbound === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  else process.env.SNAPBACK_OUTBOUND_ACTIONS = priorOutbound;

  const suggestionResult = primed.generated.ok
    ? suggestDeclarations({ backendDir: primed.backend })
    : null;
  const counts = emptyCounts();
  for (const suggestion of suggestionResult?.suggestions ?? []) counts[suggestion.status] += 1;
  const evidenceClasses = countEvidenceClasses(suggestionResult?.suggestions ?? []);
  const after = sourceInventory(backend);
  primed.cleanup?.();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`rollout modified source bytes under ${job.backend}`);
  }
  results.push({
    schemaVersion: 'snapback.declaration-suggestion-rollout-backend.v1',
    backend: job.backend,
    candidates: Object.values(counts).reduce((sum, value) => sum + value, 0),
    counts,
    proportions: proportions(counts),
    evidenceClasses,
    priming: primed.priming,
    diagnostics: primed.generated.ok
      ? (suggestionResult.ok ? [] : suggestionResult.diagnostics)
      : primed.generated.diagnostics,
    sourceBytesChanged: false,
  });
}

const aggregateCounts = emptyCounts();
const aggregateEvidenceClasses = emptyEvidenceClassCounts();
for (const result of results) {
  for (const key of STATUS_KEYS) aggregateCounts[key] += result.counts[key];
  for (const key of EVIDENCE_CLASS_KEYS) {
    for (const metric of Object.keys(aggregateEvidenceClasses[key])) {
      aggregateEvidenceClasses[key][metric] += result.evidenceClasses[key][metric];
    }
  }
}
const report = {
  schemaVersion: 'snapback.declaration-suggestion-rollout.v1',
  artifactKind: 'declarationSuggestionRollout',
  corpus: uniqueJobs.map(({ backend }) => backend),
  deliberateNegativeFixturesExcluded: [...DELIBERATE_NEGATIVE_FIXTURES],
  results,
  aggregate: {
    candidates: Object.values(aggregateCounts).reduce((sum, value) => sum + value, 0),
    counts: aggregateCounts,
    proportions: proportions(aggregateCounts),
    evidenceClasses: aggregateEvidenceClasses,
  },
  sourceBytesChanged: false,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
