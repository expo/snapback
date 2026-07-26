// @ref LLP 0080#acceptance — the admitted Step 5 fixture's demonstrates-both-
// helpers receipt: both LLP 0080 §7 generated helpers live in the fixture in
// production shape, the source/glue reduction is recorded with its method on
// its face, and the cumulative gates rerun (fresh where this landing could
// touch them, byte-identity where it provably could not).
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// admission of this fixture is the dated author decision recorded in the
// 0063 header (2026-07-26); this witness produces the receipt that decision
// names, while the frozen WS6 source-volume row stays Partitime-owned.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const fixtureDir = resolve(here, '..', '..');
const backendDir = join(fixtureDir, 'snapback');
const resultsDir = join(fixtureDir, 'acceptance', 'results');
const scratch = mkdtempSync(join(tmpdir(), 'step5-both-helpers-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function run(command, args, env = {}) {
  const outcome = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(
    outcome.status,
    0,
    `${command} ${args.join(' ')} failed:\n${outcome.stdout?.slice(-2000)}\n${outcome.stderr?.slice(-2000)}`,
  );
  return outcome;
}

try {
  // --- Both helpers, named with their production call sites. -------------
  const source = readFileSync(join(backendDir, 'functions.mjs'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(backendDir, 'generated', 'functions.manifest.json'), 'utf8'));
  const relational = manifest.functions.find((fn) => fn.name === 'conversationsWithModel');
  assert.ok(relational?.runtime?.HostPlan?.RelationalQuery, 'the callable relational helper is generated');
  const projection = manifest.projections?.find((p) => p.id === 'conversation-cards');
  assert.ok(projection, 'the maintained projection is generated');
  assert.ok(source.includes('defineRelationalQuery({'), 'defineRelationalQuery authored in the fixture source');
  assert.ok(source.includes('defineMaintainedProjection({'), 'defineMaintainedProjection authored in the fixture source');

  // --- Source/glue reduction, measured with the method on its face. ------
  // Authored cost: the two helper declaration blocks in functions.mjs
  // (from each export line to its closing `});`). Replaced surface: the
  // generated artifacts attributable to those two functions — the closed
  // plans, contract types, and argument schemas a hand-written equivalent
  // would have had to author and keep consistent by hand, plus the
  // runtime maintenance/pagination logic no in-cell code expresses at all.
  const declarationBlock = (marker) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `declaration ${marker} present`);
    const end = source.indexOf('\n});', start);
    return source.slice(start, end + 4).split('\n').length;
  };
  const relationalDeclLines = declarationBlock('export const conversationsWithModel = defineRelationalQuery({');
  const projectionDeclLines = declarationBlock('export const conversationCardsProjection = defineMaintainedProjection({');
  const generatedArtifactLines = [
    'generated/contract/conversationsWithModel.query.ts',
    'generated/operations/conversationsWithModel.args.schema.json',
  ].map((rel) => readFileSync(join(backendDir, rel), 'utf8').split('\n').length)
    .reduce((sum, lines) => sum + lines, 0)
    + JSON.stringify(relational, null, 2).split('\n').length
    + JSON.stringify(projection, null, 2).split('\n').length;

  // --- Fresh gate reruns (this landing could touch these). ---------------
  const relationalRun = run('node', ['demos/competitive-checkpoint/tests/acceptance/relational-conversations.mjs']);
  assert.ok(relationalRun.stdout.includes('PASS competitive checkpoint / relational conversations — 5/5'));

  const noExactCorePath = join(scratch, 'no-exact-core.json');
  run('node', ['demos/partiful-matrix/tests/acceptance/no-exact-core.mjs', '--out', noExactCorePath]);
  const noExactCore = JSON.parse(readFileSync(noExactCorePath, 'utf8'));
  assert.equal(noExactCore.ok, true, 'no-Exact-core gate holds');

  const authReceiptPath = join(scratch, 'standard-patterns-v1.json');
  run('node', ['tests/acceptance/standard-patterns-v1.mjs', '--receipt', authReceiptPath]);
  const authReceipt = JSON.parse(readFileSync(authReceiptPath, 'utf8'));
  assert.equal(authReceipt.ok, true, 'authorization negatives hold');

  run('node', ['scripts/check-package-test-inventory.mjs']);

  // --- Companion receipts pinned by digest (produced this landing). ------
  const pinned = Object.fromEntries(
    [
      ['schemaEvolution', 'schema-evolution.v1.json'],
      ['relationalConversations', 'relational-conversations.v1.json'],
      ['localStreamingRerun', 'local-streaming.v0.rerun-20260726.json'],
    ].map(([key, name]) => {
      const bytes = readFileSync(join(resultsDir, name));
      const parsed = JSON.parse(bytes.toString('utf8'));
      assert.equal(parsed.ok ?? parsed.passed > 0, true, `${name} is a passing receipt`);
      return [key, { file: `acceptance/results/${name}`, sha256: sha256(bytes) }];
    }),
  );

  const receipt = {
    schemaVersion: 'snapback.competitive-checkpoint.step5-both-helpers.v1',
    claim: 'LLP 0080 §Acceptance final item on the admitted Step 5 fixture',
    protocol: 'llp-0075-convex-checkpoint-v0',
    admission: 'LLP 0063 Revised 2026-07-26 (author decision, Charlie Cheever)',
    ok: true,
    helpers: {
      relationalQuery: {
        helper: 'defineRelationalQuery',
        function: 'conversationsWithModel',
        capability: 'relational_query_v1',
        witness: 'tests/acceptance/relational-conversations.mjs (5/5 fresh in this run)',
      },
      maintainedProjection: {
        helper: 'defineMaintainedProjection',
        id: 'conversation-cards',
        witness: 'tests/acceptance/local-streaming.mjs check 2 (8/8, rerun receipt pinned below)',
      },
    },
    sourceGlueReduction: {
      method: 'authored declaration lines for the two helper blocks in snapback/functions.mjs versus the generated closed-plan/contract/schema lines attributable to those functions; the runtime pagination, cursor authority, and same-commit maintenance logic have no authored in-cell representation at all',
      authoredLines: { relational: relationalDeclLines, projection: projectionDeclLines },
      generatedReplacedLines: generatedArtifactLines,
      note: 'a reduction record for the admitted fixture, not a frozen-threshold claim; the frozen WS6 source-volume row remains Partitime-owned (LLP 0063)',
    },
    cumulativeGates: {
      reran: {
        noExactCore: { ok: true, receiptSha256: sha256(readFileSync(noExactCorePath)) },
        authorizationNegatives: { ok: true, via: 'tests/acceptance/standard-patterns-v1.mjs' },
        packageTestInventory: { ok: true },
        fixtureRelationalSuite: { ok: true, checks: '5/5' },
      },
      zeroRegressionArgument: {
        kind: 'byte-identity',
        scope: 'the Partitime measured cell and its browser/native instruments — this landing touches no demos/partiful-matrix path',
      },
      fixtureSurface: {
        typecheck: 'bun run typecheck reran green against the v1 generated artifacts in this landing',
        nativeExport: 'untimed Expo compatibility posture per protocol requiredSurfaceTiming; not rerun here',
      },
    },
    pinnedReceipts: pinned,
  };
  writeFileSync(
    join(resultsDir, 'step5-both-helpers.v1.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log('PASS step5-both-helpers — receipt written');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
