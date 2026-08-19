#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_LOCAL_SUITE_CHECKS,
  EXPECTED_LOCAL_SUITE_IDS,
  LOCAL_SUITES,
  TEST_FILE_CLASSIFICATIONS,
} from './local-suite-manifest.mjs';
import { resolveLockedWrangler } from '../locked-wrangler.mjs';
import { assertProofRuntimeNode, PROOF_NODE_UNSUPPORTED_CODE } from './proof-runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

// @ref LLP 0040#acceptance — the local surrogate is a named regression
// surface; every non-remote proof must stay explicitly inventoried.

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function validateInventory() {
  resolveLockedWrangler();
  assert.equal(LOCAL_SUITES.length, EXPECTED_LOCAL_SUITE_CHECKS, 'canonical Cloudflare suite count drifted');
  assert.deepEqual(
    LOCAL_SUITES.map((suite) => suite.id),
    EXPECTED_LOCAL_SUITE_IDS,
    'canonical Cloudflare suite IDs drifted; update the explicit inventory intentionally',
  );
  assert.equal(new Set(EXPECTED_LOCAL_SUITE_IDS).size, EXPECTED_LOCAL_SUITE_IDS.length, 'duplicate suite id');

  const classifiedNames = TEST_FILE_CLASSIFICATIONS.map(([name]) => name);
  assert.equal(new Set(classifiedNames).size, classifiedNames.length, 'duplicate Cloudflare test-file classification');
  const actualNames = fs.readdirSync(here).filter((name) => name.endsWith('.mjs') && name !== 'local-suite.mjs' && name !== 'local-suite-manifest.mjs');
  assert.deepEqual(
    sorted(actualNames),
    sorted(classifiedNames),
    'Cloudflare test inventory changed; classify every file and add every non-remote regression to LOCAL_SUITES',
  );

  const gateFiles = new Set(
    TEST_FILE_CLASSIFICATIONS
      .filter(([, classification]) => classification === 'gate')
      .map(([name]) => `targets/cloudflare/test/${name}`),
  );
  const manifestedGateFiles = new Set(
    LOCAL_SUITES.filter((suite) => suite.file.startsWith('targets/cloudflare/test/')).map((suite) => suite.file),
  );
  assert.deepEqual(sorted(manifestedGateFiles), sorted(gateFiles), 'a classified local gate is not executable from the manifest');

  for (const suite of LOCAL_SUITES) {
    const absolute = path.resolve(root, suite.file);
    assert.ok(absolute.startsWith(`${root}${path.sep}`), `${suite.id}: path escapes repository root`);
    assert.ok(fs.statSync(absolute, { throwIfNoEntry: false })?.isFile(), `${suite.id}: file is missing`);
  }
}

function runSuite(suite, index) {
  const absolute = path.resolve(root, suite.file);
  const command = suite.runtime === 'direct' ? absolute : process.execPath;
  const args = suite.runtime === 'direct' ? [] : [absolute];
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const missingEvidence = (suite.evidence || []).filter((needle) => !output.includes(needle));
  if (result.error || result.status !== 0 || missingEvidence.length > 0) {
    process.stderr.write(`not ok ${index} - ${suite.id}\n`);
    if (result.error) process.stderr.write(`${result.error.stack || result.error}\n`);
    if (missingEvidence.length > 0) {
      process.stderr.write(`missing completion evidence: ${JSON.stringify(missingEvidence)}\n`);
    }
    process.stderr.write(output);
    throw new Error(`${suite.id} failed with status ${String(result.status)}`);
  }
  process.stdout.write(`ok ${index}/${EXPECTED_LOCAL_SUITE_CHECKS} - ${suite.id}\n`);
}

// @ref LLP 0040#proof-runtime-preflight-2026-07-14-eng-24454 — refuse the whole
// gate once, with one actionable diagnostic, before spawning any suite child on
// an unsupported Node major (the children reuse this same process.execPath).
function preflightProofRuntime() {
  try {
    assertProofRuntimeNode();
  } catch (error) {
    if (error?.code === PROOF_NODE_UNSUPPORTED_CODE) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

preflightProofRuntime();
validateInventory();
for (const [index, suite] of LOCAL_SUITES.entries()) runSuite(suite, index + 1);
console.log(`cloudflare local suite: ${LOCAL_SUITES.length}/${EXPECTED_LOCAL_SUITE_CHECKS} explicit checks passed`);
