#!/usr/bin/env node

// @ref LLP 0173#5-ci-semantics — regenerate the registered corpus in check-only
// mode and compare canonical projection bytes, identity, schema authority, and
// mandatory consumer custody. This checker never adjudicates policy changes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  AUTHORIZATION_REVIEW_FILE,
  AUTHORIZATION_REVIEW_SCHEMA_AUTHORITY,
  compareAuthorizationReviews,
  renderAuthorizationReviewDiff,
  validateAuthorizationReview,
} from '../packages/snapback-codegen/authorization-review.mjs';
import { generate } from '../packages/snapback-codegen/index.mjs';
import {
  CODEGEN_JOBS,
  codegenOutputRoot,
} from './generated-artifact-policy.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectionSchema = JSON.parse(readFileSync(
  join(repositoryRoot, 'packages/snapback-codegen/authorization-review.schema.json'),
));
const validateProjectionSchema = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
}).compile(projectionSchema);
const args = process.argv.slice(2);
const againstGit = args.includes('--against-git');
if (args.some((arg) => arg !== '--against-git')) {
  process.stderr.write('usage: node scripts/check-authorization-review.mjs [--against-git]\n');
  process.exit(2);
}

let failed = false;
let changedAgainstGit = 0;
for (const job of CODEGEN_JOBS) {
  const backend = resolve(repositoryRoot, job.backend);
  const generatedRoot = resolve(repositoryRoot, codegenOutputRoot(job));
  const projectionPath = join(generatedRoot, AUTHORIZATION_REVIEW_FILE);
  const priorOutbound = process.env.SNAPBACK_OUTBOUND_ACTIONS;
  if (job.outboundActions) process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
  else delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  const result = await generate(backend, {
    check: true,
    ...(job.targetProfile ? { targetProfile: job.targetProfile } : {}),
  });
  if (priorOutbound === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  else process.env.SNAPBACK_OUTBOUND_ACTIONS = priorOutbound;

  if (!result.ok) {
    failed = true;
    process.stderr.write(
      `[check-authorization-review] ${job.backend}: regeneration failed\n${JSON.stringify(result.diagnostics, null, 2)}\n`,
    );
    continue;
  }
  if (!existsSync(projectionPath)) {
    failed = true;
    process.stderr.write(`[check-authorization-review] ${job.backend}: ${AUTHORIZATION_REVIEW_FILE} is missing\n`);
    continue;
  }
  const candidate = result.authorizationReview;
  const candidateProblems = validateAuthorizationReview(candidate);
  if (!validateProjectionSchema(candidate)) {
    candidateProblems.push(
      ...validateProjectionSchema.errors.map((error) => (
        `schema ${error.instancePath || '/'} ${error.message}`
      )),
    );
  }
  const record = result.artifactIndex.files.find(({ path }) => path === AUTHORIZATION_REVIEW_FILE);
  const identityProblems = [];
  if (candidate.inputsHash !== result.inputsHash
      || candidate.inputsHash !== result.artifactIndex.inputsHash) {
    identityProblems.push('inputsHash does not match the fresh generated graph');
  }
  if (
    record?.custody !== 'consumer-committed'
    || record?.authority !== AUTHORIZATION_REVIEW_SCHEMA_AUTHORITY
  ) {
    identityProblems.push('artifact record lacks mandatory consumer custody or schema authority');
  }
  const committedBytes = readFileSync(projectionPath);
  const comparison = compareAuthorizationReviews(committedBytes, candidate);
  try {
    const committed = JSON.parse(committedBytes);
    if (!validateProjectionSchema(committed)) {
      comparison.problems.push(
        ...validateProjectionSchema.errors.map((error) => (
          `committed schema ${error.instancePath || '/'} ${error.message}`
        )),
      );
    }
  } catch {
    // compareAuthorizationReviews already supplies the parse problem.
  }
  const problems = [...candidateProblems, ...identityProblems, ...comparison.problems];
  if (!comparison.current || problems.length > 0) {
    failed = true;
    process.stderr.write(`[check-authorization-review] ${job.backend}: projection is stale or invalid\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    if (comparison.diff) process.stderr.write(`${comparison.diff}\n`);
  }

  if (againstGit) {
    const repositoryPath = relative(repositoryRoot, projectionPath).replaceAll('\\', '/');
    let previous = null;
    try {
      previous = JSON.parse(execFileSync(
        'git',
        ['-C', repositoryRoot, 'show', `HEAD:${repositoryPath}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ));
    } catch {
      // A newly introduced projection has an empty structural baseline.
    }
    const diff = renderAuthorizationReviewDiff(previous ?? {
      operations: [],
      tablePolicies: [],
    }, candidate);
    if (diff) {
      changedAgainstGit += 1;
      process.stderr.write(`[authorization-review diff] ${repositoryPath}\n${diff}\n`);
    }
  }
}

if (failed) process.exit(1);
process.stdout.write(
  `[check-authorization-review] ok: ${CODEGEN_JOBS.length} projections are schema-valid, identity-bound, consumer-committed, and current`
  + (againstGit ? `; ${changedAgainstGit} differ from HEAD` : '')
  + '\n',
);
