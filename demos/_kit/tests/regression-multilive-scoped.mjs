// Regression: multi-live `liveQueries` accepts `{ name, args }` entries and
// the scoped args actually reach the server subscription (LLP 0034 §10.4).
//
// Guards the seam the graffiti wall landed on: a board-scoped live query in
// multi-query mode. Asserts (1) the configured args are the subscription's
// args — rows arrive scoped, and updates land under the query-name boundary
// key via live push; (2) an update outside the scope does NOT arrive;
// (3) duplicate liveQueries names are rejected at creation with a structured
// SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE diagnostic; (4) a binding whose args
// deep-differ from the configured entry's records a structured
// SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH diagnostic instead of silently
// serving the other scope unlabeled.
//
// Uses the graffiti demo's generated artifacts as the scoped-query fixture
// (the same precedent regression-optimistic-clobber sets with todo's).
// Needs the Exact runtime, which imports .js-suffixed TypeScript modules that
// resolve ONLY under bun — run this suite with bun, never plain node. Under node
// the Exact runtime import crashes with a cryptic ERR_MODULE_NOT_FOUND (ENG-
// 22655); the requireBunRuntime guard below turns that into a clear message.
// Skips with the standard structured diagnostic when no Exact checkout resolves.
//
// Run: bun demos/_kit/tests/regression-multilive-scoped.mjs   (NOT node)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { resolveExact } from '../exact-resolver.mjs';
import { assert, assertEqual, createSuite, requireBunRuntime } from '../harness.mjs';

// ENG-22655: fail fast with a "run under bun" message before the Exact runtime
// import can crash under node with an unhelpful module-resolution stack.
requireBunRuntime('_kit regression / multilive-scoped');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'graffiti', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));
const { createSnapbackContractSurface } = await import(join(repoRoot, 'packages/snapback-contract/index.mjs'));
const { importExactContractRuntime } = await import(join(repoRoot, 'packages/snapback-contract/exact-package.mjs'));

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  console.log(JSON.stringify({
    title: '_kit regression / multilive-scoped',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    diagnostics: exact.diagnostics,
  }, null, 2));
  console.log('\nSKIP (valid, expected_missing): _kit regression / multilive-scoped');
  process.exit(0);
}

const runtime = await importExactContractRuntime({ exactRoot: exact.path });
const server = await startServer({ port: 4434, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / multilive-scoped (LLP 0034 §10.4)');
const ADA = 'painter_ada';
const BOARD = 'wall';
const OTHER_BOARD = 'annex';

const waitFor = async (predicate, label, timeoutMs = 6_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
};

const surfaceOptions = (client) => ({
  runtime,
  client,
  userId: ADA,
  manifest: gen('contract-data.manifest.json'),
  artifactIndex: gen('artifacts.json'),
  schemaManifest: gen('schema.manifest.json'),
  functionManifest: gen('functions.manifest.json'),
  ephemeralPermissions: (_name, scope) => [SnapbackClient.roomPermission('boardMember', scope)],
});

try {
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  const surface = await createSnapbackContractSurface({
    ...surfaceOptions(db),
    liveQueries: [{ name: 'listCells', args: { boardId: BOARD } }],
  });

  let rows = null;
  const sub = surface.links.listCells({ boardId: BOARD }).subscribe((delivered) => { rows = delivered; });

  await suite.check('configured { name, args } reach the server subscription (scoped snapshot)', async () => {
    await waitFor(() => Array.isArray(rows) && rows.length === 59, 'scoped seed snapshot');
    assert(rows.every((r) => r.boardId === BOARD), 'every row is scoped to the configured board');
    return { rows: rows.length, livePush: surface.livePush, liveQueries: surface.liveQueries };
  });

  await suite.check('an in-scope update lands under the query-name boundary key via live push', async () => {
    await db.mutate('paintCell', { args: { boardId: BOARD, x: 9, y: 9, color: '#e93d82' }, userId: ADA });
    await waitFor(() => (rows ?? []).some((r) => r.x === 9 && r.y === 9 && r.color === '#e93d82'), 'in-scope live push');
    return { rows: rows.length };
  });

  await suite.check('an out-of-scope update does not arrive (the args really filter)', async () => {
    const before = rows.length;
    await db.mutate('paintCell', { args: { boardId: OTHER_BOARD, x: 1, y: 1, color: '#000000' }, userId: ADA });
    // Give a wrong-scope delivery every chance to arrive before asserting.
    await sleep(600);
    assertEqual(rows.length, before, 'row count must not grow on another board\'s paint');
    assert(!rows.some((r) => r.boardId === OTHER_BOARD), 'no foreign-board rows');
    return { rows: rows.length };
  });

  await suite.check('binding args that differ from the configured entry are diagnosed, not silent', async () => {
    const before = surface.diagnostics.filter((d) => d.code === 'SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH').length;
    let mismatchRows = null;
    const mismatchSub = surface.links.listCells({ boardId: OTHER_BOARD }).subscribe((delivered) => { mismatchRows = delivered; });
    await waitFor(() => Array.isArray(mismatchRows), 'mismatched binding delivery');
    const diags = surface.diagnostics.filter((d) => d.code === 'SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH');
    assert(diags.length === before + 1, 'exactly one new args-mismatch diagnostic');
    assertEqual(diags.at(-1).details.query, 'listCells', 'diagnostic names the query');
    assertEqual(diags.at(-1).details.bindingArgs, { boardId: OTHER_BOARD }, 'diagnostic carries the binding args');
    // Same distinct args again: diagnosed once, not spammed.
    const repeatSub = surface.links.listCells({ boardId: OTHER_BOARD }).subscribe(() => {});
    await sleep(50);
    assertEqual(
      surface.diagnostics.filter((d) => d.code === 'SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH').length,
      before + 1,
      'repeat mismatch with identical args is not re-diagnosed',
    );
    mismatchSub.dispose?.();
    repeatSub.dispose?.();
    return { code: diags.at(-1).code };
  });

  await suite.check('duplicate liveQueries names are rejected with a structured diagnostic', async () => {
    let threw = null;
    try {
      await createSnapbackContractSurface({
        ...surfaceOptions(new SnapbackClient(server.baseUrl, server.clientOptions)),
        liveQueries: ['listCells', { name: 'listCells', args: { boardId: BOARD } }],
      });
    } catch (error) {
      threw = error;
    }
    assert(threw, 'duplicate names must throw');
    assertEqual(threw.diagnostic?.code, 'SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE', 'structured diagnostic code');
    assertEqual(threw.diagnostic?.details?.duplicates, ['listCells'], 'diagnostic names the duplicate');
    return { code: threw.diagnostic.code };
  });

  sub.dispose?.();
  surface.dispose();
  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('multilive-scoped regression crashed:', error);
  await server.stop();
  process.exit(2);
}
