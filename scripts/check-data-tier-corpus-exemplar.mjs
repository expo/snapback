#!/usr/bin/env node

// Gate (c): the negative exemplar is a real in-corpus mutation.
// @ref LLP 0051#increments — applyLiveFeedSnapshot must remain outside the IR
// with the class-specific diagnostic after the registered demo is regenerated.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(
  repositoryRoot,
  'demos',
  'all-aboard',
  'snapback',
  'generated',
  'functions.manifest.json',
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const outgrown = (manifest.unsupportedDependencyDiagnostics ?? []).find(
  (diagnostic) => diagnostic.code === 'MUTATION_OUTGREW_IR'
    && diagnostic.details?.function === 'applyLiveFeedSnapshot',
);

const failures = [];
if (!outgrown) {
  failures.push(
    'all-aboard functions.manifest.json is missing the MUTATION_OUTGREW_IR diagnostic for applyLiveFeedSnapshot (gate c)',
  );
} else {
  if (outgrown.details.class !== 'conditional-writes') {
    failures.push(`outgrew-IR class is ${outgrown.details.class}, expected conditional-writes`);
  }
  if (!outgrown.message.includes('outgrew the IR: conditional writes')) {
    failures.push(`outgrew-IR message lacks the class-specific text: ${outgrown.message}`);
  }
  if (outgrown.severity !== 'info') {
    failures.push(`outgrew-IR severity is ${outgrown.severity}, expected info`);
  }
}

for (const failure of failures) {
  console.error(`[data-tier-corpus-exemplar] FAIL: ${failure}`);
}
if (failures.length > 0) {
  console.error(`[data-tier-corpus-exemplar] ${failures.length} failure(s)`);
  process.exit(1);
}

console.log('data-tier-corpus-exemplar: applyLiveFeedSnapshot outgrew-IR diagnostic verified');
