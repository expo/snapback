// Regression: a concurrent live_replace must not clobber an in-flight
// optimistic row out of the Contract boundary (LLP 0034 review fix 3).
//
// With live push, another client's fan-out can arrive DURING a local
// mutation's in-flight window carrying authoritative rows that legitimately
// lack the optimistic row at a valid higher version — version checks cannot
// help. The adapter re-applies the still-in-flight optimistic reducers on top
// of every server-rows write, so the user's own row never flashes out.
//
// Needs the Exact runtime, which imports .js-suffixed TypeScript modules that
// resolve ONLY under bun — run this suite with bun, never plain node. Under node
// the Exact runtime import crashes with a cryptic ERR_MODULE_NOT_FOUND (ENG-
// 22655); the requireBunRuntime guard below turns that into a clear message.
// Skips with the standard structured diagnostic when no Exact checkout resolves.
//
// Run: bun demos/_kit/tests/regression-optimistic-clobber.mjs   (NOT node)
//
// Derived from the review probe (scratchpad probe-optimistic-clobber.mjs,
// which exited 1 while the bug was present); assertions inverted.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { resolveExact } from '../exact-resolver.mjs';
import { assert, createSuite, requireBunRuntime } from '../harness.mjs';

// ENG-22655: fail fast with a "run under bun" message before the Exact runtime
// import can crash under node with an unhelpful module-resolution stack.
requireBunRuntime('_kit regression / optimistic-clobber');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'todo', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));
const { createSnapbackContractSurface } = await import(join(repoRoot, 'packages/snapback-contract/index.mjs'));
const { importExactContractRuntime } = await import(join(repoRoot, 'packages/snapback-contract/exact-package.mjs'));
const { todoOptimisticReducers } = await import(join(repoRoot, 'demos/todo/surfaces/contract/optimistic.mjs'));

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  console.log(JSON.stringify({
    title: '_kit regression / optimistic-clobber',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    diagnostics: exact.diagnostics,
  }, null, 2));
  console.log('\nSKIP (valid, expected_missing): _kit regression / optimistic-clobber');
  process.exit(0);
}

const runtime = await importExactContractRuntime({ exactRoot: exact.path });
const server = await startServer({ port: 4418, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('_kit regression / optimistic-clobber (LLP 0034 review fix 3)');
const ADA = 'user_ada';

const waitFor = async (predicate, label, timeoutMs = 6_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
};

let surface = null;
try {
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  // The surface's client commits createTodo slowly: a 700ms in-flight window.
  const slow = new SnapbackClient(server.baseUrl);
  const realMutate = SnapbackClient.prototype.mutate;
  slow.mutate = async function (ref, opts) {
    const name = typeof ref === 'string' ? ref : ref?.name;
    if (name === 'createTodo') await sleep(700);
    return realMutate.call(this, ref, opts);
  };

  surface = await createSnapbackContractSurface({
    runtime,
    client: slow,
    userId: ADA,
    manifest: gen('contract-data.manifest.json'),
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: todoOptimisticReducers,
  });
  await waitFor(() => surface.connection() === 'live', "surface connection 'live'");

  await suite.check('an in-flight optimistic row survives a concurrent external live_replace', async () => {
    let sawMineDisappear = false;
    let mineEverSeen = false;
    let latest = [];
    const sub = surface.provider.subscribe('listTodos', {}, (cell) => {
      if (cell.status !== 'ready' && cell.status !== 'refreshing') return;
      latest = cell.value;
      const hasMine = latest.some((r) => r.title === 'MINE');
      if (mineEverSeen && !hasMine) sawMineDisappear = true;
      if (hasMine) mineEverSeen = true;
    });
    try {
      // t0: optimistic MINE (commit delayed 700ms).
      const tracked = surface.links.createTodo({ title: 'MINE' });
      assert(latest.some((r) => r.title === 'MINE'), 'optimistic row missing immediately after the write');

      // t+50: another client commits THEIRS; its fan-out (no MINE in it)
      // arrives over the stream while MINE is still in flight.
      await sleep(50);
      const other = new SnapbackClient(server.baseUrl);
      await other.mutate('createTodo', { args: { title: 'THEIRS' }, userId: ADA });
      await waitFor(() => latest.some((r) => r.title === 'THEIRS'), "the concurrent client's row");
      assert(!sawMineDisappear, 'optimistic row flashed out of the boundary during the in-flight window');
      assert(latest.some((r) => r.title === 'MINE'), 'optimistic row missing mid-flight');

      // Settle: both rows converge, exactly once each.
      await tracked;
      await surface.flush();
      await waitFor(
        () => latest.filter((r) => r.title === 'MINE').length === 1 && latest.some((r) => r.title === 'THEIRS'),
        'converged final state',
      );
      assert(!sawMineDisappear, 'optimistic row flashed out before convergence');
      return { titles: latest.map((r) => r.title) };
    } finally {
      sub.dispose();
    }
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  surface?.dispose?.();
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('regression harness crashed:', error);
  surface?.dispose?.();
  await server.stop();
  process.exit(2);
}
