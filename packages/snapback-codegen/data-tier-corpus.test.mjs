// Regen-and-diff gate for the data-tier conformance corpus (LLP 0051 D5),
// plus the Increment 3 builder-parity assertions (gate b).
//
// Modes:
//   node packages/snapback-codegen/data-tier-corpus.test.mjs          # verify
//   node packages/snapback-codegen/data-tier-corpus.test.mjs --write  # regenerate
//
// Verify mode rebuilds every case from the typed builder and fails if the
// committed tests/conformance/data-tier/*.case.json differ — the same
// stale-output posture as scripts/check-generated-artifacts. The committed
// JSON is the cross-language contract; the Rust runner
// (tests/data_tier_corpus_v0.rs) and Exact-side consumers (LLP 0329 E-A)
// read the files, never this module.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorpusCases, buildResetFeedPlan, buildApplyFeedTickPlan, PATTERN_IDS } from './data-tier-corpus.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS_DIR = join(REPO_ROOT, 'tests', 'conformance', 'data-tier');
const WRITE = process.argv.includes('--write');

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`[data-tier-corpus] FAIL: ${message}`);
};

// --- Gate (b) parity assertions: the plans are authored via the builder ---
// (constant-driven unrolls as .map metaprogramming) and PATTERN_IDS mirrors
// the demo's module constant.
{
  const handlersSource = readFileSync(join(REPO_ROOT, 'demos', 'all-aboard', 'snapback', 'handlers.mjs'), 'utf8');
  const declared = handlersSource.match(/const PATTERN_IDS = \[([^\]]+)\]/);
  if (!declared) {
    fail('could not find PATTERN_IDS in demos/all-aboard/snapback/handlers.mjs');
  } else {
    const demoIds = declared[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    if (JSON.stringify(demoIds) !== JSON.stringify(PATTERN_IDS)) {
      fail(`PATTERN_IDS drift: demo has ${JSON.stringify(demoIds)}, corpus has ${JSON.stringify(PATTERN_IDS)}`);
    }
  }
  const resetSteps = buildResetFeedPlan().steps.length;
  if (resetSteps !== PATTERN_IDS.length + 2) fail(`resetFeed builder plan has ${resetSteps} steps, expected ${PATTERN_IDS.length + 2}`);
  const tickSteps = buildApplyFeedTickPlan().steps.length;
  if (tickSteps !== PATTERN_IDS.length + 7) fail(`applyFeedTick builder plan has ${tickSteps} steps, expected ${PATTERN_IDS.length + 7}`);
}

// --- Gate (c): the negative exemplar is a real in-corpus mutation ---
// applyLiveFeedSnapshot's generated manifest carries the class-specific
// "outgrew the IR: conditional writes" info diagnostic.
{
  const manifestPath = join(REPO_ROOT, 'demos', 'all-aboard', 'snapback', 'generated', 'functions.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const outgrown = (manifest.unsupportedDependencyDiagnostics ?? []).find(
    (d) => d.code === 'MUTATION_OUTGREW_IR' && d.details?.function === 'applyLiveFeedSnapshot',
  );
  if (!outgrown) {
    fail('all-aboard functions.manifest.json is missing the MUTATION_OUTGREW_IR diagnostic for applyLiveFeedSnapshot (gate c)');
  } else {
    if (outgrown.details.class !== 'conditional-writes') fail(`outgrew-IR class is ${outgrown.details.class}, expected conditional-writes`);
    if (!outgrown.message.includes('outgrew the IR: conditional writes')) fail(`outgrew-IR message lacks the class-specific text: ${outgrown.message}`);
    if (outgrown.severity !== 'info') fail(`outgrew-IR severity is ${outgrown.severity}, expected info`);
  }
}

const cases = buildCorpusCases();
const names = new Set();
for (const corpusCase of cases) {
  if (names.has(corpusCase.name)) fail(`duplicate case name ${corpusCase.name}`);
  names.add(corpusCase.name);
}

if (WRITE) {
  mkdirSync(CORPUS_DIR, { recursive: true });
  for (const corpusCase of cases) {
    const path = join(CORPUS_DIR, `${corpusCase.name}.case.json`);
    writeFileSync(path, `${JSON.stringify(corpusCase, null, 2)}\n`);
    console.log(`wrote ${path}`);
  }
  // Remove orphaned case files so a renamed case cannot leave a stale twin.
  for (const file of readdirSync(CORPUS_DIR)) {
    if (!file.endsWith('.case.json')) continue;
    const name = file.slice(0, -'.case.json'.length);
    if (!names.has(name)) {
      fail(`orphaned committed case ${file} — delete it or restore its builder`);
    }
  }
} else {
  if (!existsSync(CORPUS_DIR)) {
    fail(`missing ${CORPUS_DIR}; run with --write`);
  } else {
    const committed = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.case.json'));
    for (const corpusCase of cases) {
      const path = join(CORPUS_DIR, `${corpusCase.name}.case.json`);
      const expected = `${JSON.stringify(corpusCase, null, 2)}\n`;
      let actual;
      try {
        actual = readFileSync(path, 'utf8');
      } catch {
        fail(`missing committed case ${corpusCase.name}.case.json — run with --write`);
        continue;
      }
      if (actual !== expected) {
        fail(`stale committed case ${corpusCase.name}.case.json — run with --write and commit`);
      }
    }
    for (const file of committed) {
      const name = file.slice(0, -'.case.json'.length);
      if (!names.has(name)) fail(`orphaned committed case ${file}`);
    }
  }
}

if (failures > 0) {
  console.error(`[data-tier-corpus] ${failures} failure(s)`);
  process.exit(1);
}
console.log(`data-tier-corpus.test.mjs: ${cases.length} cases ${WRITE ? 'written' : 'verified'}; builder-parity assertions passed`);
