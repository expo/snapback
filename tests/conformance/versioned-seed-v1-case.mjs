#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const at = process.argv.indexOf('--case');
const id = at >= 0 ? process.argv[at + 1] : null;
const evidenceRoot = process.env.SNAPBACK_VERSIONED_SEED_CASE_EVIDENCE_DIR;

if (!id || !evidenceRoot) {
  process.stdout.write(JSON.stringify({
    id,
    outcome: 'failed',
    assertionCount: 0,
    diagnostic: 'SNAPBACK_SEED_CONFORMANCE_EVIDENCE_MISSING',
  }));
  process.exit(1);
}

let evidence;
try {
  evidence = JSON.parse(readFileSync(resolve(evidenceRoot, `${id}.json`), 'utf8'));
} catch {
  process.stdout.write(JSON.stringify({
    id,
    outcome: 'failed',
    assertionCount: 0,
    diagnostic: 'SNAPBACK_SEED_CONFORMANCE_EVIDENCE_INVALID',
  }));
  process.exit(1);
}

const valid = evidence?.artifactKind === 'snapback.versioned-seed-case-evidence.v1'
  && evidence.id === id
  && evidence.outcome === 'passed'
  && Number.isSafeInteger(evidence.assertionCount)
  && evidence.assertionCount > 0;
if (id === 'predecessor-legacy-reset-rotates-away') {
  const predecessor = evidence?.predecessor;
  if (predecessor?.gitCommit !== '3db3185a8325b5e8209b637080ab65d775c880ea'
    || typeof predecessor?.buildRecipe !== 'string'
    || !/^[0-9a-f]{64}$/u.test(predecessor?.buildInputsDigest ?? '')
    || !/^[0-9a-f]{64}$/u.test(predecessor?.binarySha256 ?? '')
    || typeof predecessor?.binaryBuildIdentity !== 'string'
    || predecessor?.legacyResetObservation !== 'active-versioned-seed-identity-absent') {
    process.stdout.write(JSON.stringify({
      id,
      outcome: 'failed',
      assertionCount: 0,
      diagnostic: 'SNAPBACK_SEED_PREDECESSOR_EVIDENCE_INVALID',
    }));
    process.exit(1);
  }
}

process.stdout.write(JSON.stringify(valid
  ? evidence
  : {
      id,
      outcome: 'failed',
      assertionCount: 0,
      diagnostic: 'SNAPBACK_SEED_CONFORMANCE_EVIDENCE_INVALID',
    }));
if (!valid) process.exitCode = 1;
