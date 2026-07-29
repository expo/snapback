// Regression: two EphemeralOverlays on ONE connection, different rooms — no
// cross-room contamination (ENG-22478 review fix B).
//
// The lane registry routes every ephemeral envelope on a connection to every
// registered overlay; pre-fix, apply() ignored message.room, so board A's
// snapshot/upserts landed in board B's overlay (and a foreign snapshot could
// clobber entries + scopeEpoch). Each overlay now filters on its own room
// identity, captured from its own subscribe snapshot.
//
// Run: node demos/_kit/tests/regression-overlay-crossroom.mjs
//
// Derived from the review probe (scratchpad probe-overlay-crossroom.mjs,
// which exited 1 while the bug was present); assertions inverted.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { generate } from '../codegen.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const todoBackend = join(repoRoot, 'demos', 'todo', 'snapback');
const todoFixtures = join(repoRoot, 'demos', 'todo', 'tests', 'acceptance', 'fixtures');
const gen = (f) => JSON.parse(readFileSync(join(todoBackend, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));

const server = await startServer({ port: 4421, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / overlay-crossroom (ENG-22478 review fix B)');
const ADA = 'user_ada';

try {
  const fixtureDir = mkdtempSync(join(todoFixtures, '.tmp-crossroom-'));
  cpSync(join(todoFixtures, 'ephemeral-backend'), fixtureDir, { recursive: true });
  let generated;
  try {
    generated = await generate(fixtureDir);
    assert(generated.ok, 'fixture codegen');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
  await db.loadSchema({
    ...gen('schema.manifest.json'),
    schemaHash: 'sha256:crossroom',
    inputsHash: 'crossroom',
    ephemeralCollections: generated.schemaManifest.ephemeralCollections,
  });
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(todoBackend, 'seed.json'), 'utf8')));

  await suite.check("board A's traffic never lands in board B's overlay (one connection)", async () => {
    const scopeA = { boardId: 'board_A' };
    const scopeB = { boardId: 'board_B' };
    const permsA = [SnapbackClient.roomPermission('boardMember', scopeA)];
    const permsB = [SnapbackClient.roomPermission('boardMember', scopeB)];
    // ONE connection, two rooms.
    const overlayA = await db.subscribeEphemeral('boardCursors', {
      connectionId: 'both_rooms',
      scope: scopeA,
      userId: ADA,
      permissions: permsA,
      transport: 'poll',
    });
    const overlayB = await db.subscribeEphemeral('boardCursors', {
      connectionId: 'both_rooms',
      scope: scopeB,
      userId: ADA,
      permissions: permsB,
      transport: 'poll',
    });
    try {
      // Publishers in each room (separate connections so keys differ).
      const publishedA = await db.publishEphemeral('boardCursors', { connectionId: 'painter_A', scope: scopeA, userId: ADA, permissions: permsA, value: { x: 1, y: 1 } });
      const publishedB = await db.publishEphemeral('boardCursors', { connectionId: 'painter_B', scope: scopeB, userId: ADA, permissions: permsB, value: { x: 2, y: 2 } });
      // One drain on the shared connection routes BOTH rooms' envelopes to
      // BOTH overlays; the room filter must keep each overlay clean.
      await overlayA.drain();
      await overlayB.drain();

      assertEqual(
        overlayA.currentEntries().map((entry) => entry.key),
        [publishedA.key],
        "overlay A holds ONLY board A's cursor",
      );
      assertEqual(
        overlayB.currentEntries().map((entry) => entry.key),
        [publishedB.key],
        "overlay B holds ONLY board B's cursor",
      );

      // Epoch integrity: a foreign snapshot must not clobber scopeEpoch —
      // subsequent same-room updates still apply.
      const updatedA = await db.publishEphemeral('boardCursors', { connectionId: 'painter_A', scope: scopeA, userId: ADA, permissions: permsA, value: { x: 5, y: 5 } });
      await overlayA.drain();
      await overlayB.drain();
      const updated = overlayA.currentEntries().find((entry) => entry.key === updatedA.key);
      assertEqual(updated.value, { x: 5, y: 5 }, "board A's update applied after cross-room traffic");
      assert(
        !overlayB.currentEntries().some((entry) => entry.key === updatedA.key),
        'overlay B still clean after further traffic',
      );
      return { a: overlayA.currentEntries().length, b: overlayB.currentEntries().length };
    } finally {
      overlayA.dispose();
      overlayB.dispose();
    }
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('regression harness crashed:', error);
  await server.stop();
  process.exit(2);
}
