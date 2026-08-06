// LLP 0185 Phase 2b: parallel suites share one expensive prepared parent
// while receiving isolated derived instances, fork-per-agent ownership binds
// cleanup to an exact owner/run identity, and an interruption settles into
// one of the three named dispositions — fully cleaned, owner-swept orphan,
// or quarantined-then-recovered publication.

import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import {
  discoverOwnedForks,
  dropOwnedForks,
  recoverForkDestination,
  resolveWorktreeIdentity,
  startAgentFork,
  startWorktreeFork,
} from '../../../_kit/instance-fork.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedDir = join(backendDir, 'generated');
const appRoot = join(here, '..', '..');
const serverBinary = join(repoRoot, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ADA = 'user_ada';
const OWNER = 'todo-parallel-suite';
const STAGING_SENTINEL = '.snapback-fork-staging.v1';

const scratch = mkdtempSync(join(tmpdir(), 'snapback-fork-parallel-'));
const parentDir = join(scratch, 'parent');
const parentDb = join(parentDir, 'todo.sqlite3');
const forkRoot = join(scratch, 'forks');
mkdirSync(parentDir);
mkdirSync(forkRoot);

const suite = createSuite('todo / parallel forks + interruption dispositions', {
  expectedChecks: 7,
});
const cleanups = [() => rmSync(scratch, { recursive: true, force: true })];
const forkOptions = { from: parentDb, appRoot, repoRoot, forkRoot, ttl: '10m', serverBinary };
const ownedOptions = { repoRoot, appRoot, forkRoot, serverBinary };

await runAcceptance(suite, async () => {
  // One expensive prepared parent, seeded once.
  const initialParent = await startServer({
    port: 0,
    db: parentDb,
    cwd: repoRoot,
    serverBinary,
    provenance: { appId: 'todo', artifactsPath: join(generatedDir, 'artifacts.json') },
  });
  const parentClient = new SnapbackClient(initialParent.baseUrl, initialParent.clientOptions);
  await parentClient.ensureApp({
    schema: readJson(join(generatedDir, 'schema.manifest.json')),
    functions: readJson(join(generatedDir, 'functions.manifest.json')),
    seed: readJson(join(backendDir, 'seed.json')),
  });
  await parentClient.mutate('createTodo', {
    args: { title: 'Shared prepared parent row' },
    userId: ADA,
  });
  await initialParent.stop();

  // Three suite lanes fork the same parent concurrently.
  const lanes = ['lane-1', 'lane-2', 'lane-3'];
  const forks = await Promise.all(lanes.map((lane) => startAgentFork({
    ownerId: OWNER,
    runId: lane,
    purpose: 'parallel-suite',
    ...forkOptions,
  })));
  cleanups.push(() => Promise.allSettled(forks.map((fork) => fork.stop())));

  await suite.check('parallel forks bind distinct servers over one prepared parent', async () => {
    const ports = new Set(forks.map((fork) => new URL(fork.baseUrl).port));
    assertEqual(ports.size, lanes.length, 'every lane has its own OS-assigned port');
    const ids = new Set(forks.map((fork) => fork.fork.forkId));
    assertEqual(ids.size, lanes.length, 'every lane has its own fork identity');
    for (const fork of forks) {
      assertEqual(fork.owner.ownerId, OWNER);
      assert(lanes.includes(fork.owner.runId), 'owner record names the exact lane');
    }
  });

  await suite.check('lane writes stay isolated lane-to-lane and never reach the parent', async () => {
    await Promise.all(forks.map(async (fork, index) => {
      const client = new SnapbackClient(fork.baseUrl, fork.clientOptions);
      await client.mutate('createTodo', {
        args: { title: `Lane-only ${lanes[index]}` },
        userId: ADA,
      });
    }));
    for (const [index, fork] of forks.entries()) {
      const client = new SnapbackClient(fork.baseUrl, fork.clientOptions);
      const titles = (await client.query('listTodos', { userId: ADA })).rows
        .map((row) => row.title);
      assert(titles.includes('Shared prepared parent row'), 'prepared parent row preserved');
      assert(titles.includes(`Lane-only ${lanes[index]}`), 'own lane write visible');
      for (const other of lanes.filter((lane) => lane !== lanes[index])) {
        assert(!titles.includes(`Lane-only ${other}`), `${other} write leaked between lanes`);
      }
    }
  });

  await suite.check('each lane diff attributes exactly its own write', async () => {
    for (const [index, fork] of forks.entries()) {
      const receipt = await fork.fork.diff();
      assertEqual(receipt.rows.length, 1, 'one lane-only app-row mutation');
      assertEqual(receipt.rows[0].postImage.title, `Lane-only ${lanes[index]}`);
    }
  });

  // Disposition 1: fully cleaned — concurrent exact drops leave nothing.
  await suite.check('disposition: normal cleanup leaves no forks or registry residue', async () => {
    await Promise.all(forks.map((fork) => fork.stop()));
    const remaining = await discoverOwnedForks({ ...ownedOptions, match: { ownerId: OWNER } });
    assertEqual(remaining.length, 0, 'no suite-owned forks survive normal cleanup');
  });

  // A fork bound to this exact git worktree: identity is the canonical
  // toplevel, a nested spelling resolves identically, and cleanup binds to
  // that identity rather than any guessed directory.
  await suite.check('worktree fork binds ownership to the exact canonical worktree', async () => {
    const identity = resolveWorktreeIdentity(appRoot);
    assertEqual(resolveWorktreeIdentity(generatedDir), identity,
      'a nested subdirectory resolves to the same worktree identity');
    const worktreeFork = await startWorktreeFork({
      worktree: appRoot,
      purpose: 'worktree-suite',
      ...forkOptions,
    });
    cleanups.push(() => worktreeFork.stop().catch(() => {}));
    assertEqual(worktreeFork.owner.ownerKind, 'worktree');
    assertEqual(worktreeFork.owner.worktree, identity);
    assertEqual(worktreeFork.envExports.SNAPBACK_FORK_ID, worktreeFork.fork.forkId);
    const mine = await discoverOwnedForks({
      ...ownedOptions,
      match: { ownerKind: 'worktree', worktree: identity },
    });
    assertEqual(mine.map(({ owner }) => owner.forkId), [worktreeFork.fork.forkId]);
    const elsewhere = await discoverOwnedForks({
      ...ownedOptions,
      match: { ownerKind: 'worktree', worktree: join(identity, 'not-this-worktree') },
    });
    assertEqual(elsewhere.length, 0, 'a different worktree identity sees nothing');
    const dropped = await dropOwnedForks({
      ...ownedOptions,
      match: { ownerKind: 'worktree', worktree: identity },
    });
    assertEqual(dropped, [worktreeFork.fork.forkId]);
  });

  // Disposition 2: an unexpired orphan (its agent died without cleanup) is
  // swept later by its exact owner/run identity — and only that identity.
  await suite.check('disposition: orphaned fork is swept by exact owner/run metadata', async () => {
    const orphan = await startAgentFork({
      ownerId: OWNER,
      runId: 'orphan-run',
      purpose: 'interrupted-agent',
      ...forkOptions,
    });
    // The agent "dies" here: no stop() is registered or called.
    const wrongRun = await discoverOwnedForks({
      ...ownedOptions,
      match: { ownerId: OWNER, runId: 'some-other-run' },
    });
    assertEqual(wrongRun.length, 0, 'a different run must not see the orphan');
    const dropped = await dropOwnedForks({
      ...ownedOptions,
      match: { ownerId: OWNER, runId: 'orphan-run' },
    });
    assertEqual(dropped, [orphan.fork.forkId], 'exactly the orphan is swept');
  });

  // Disposition 3: a quarantined incomplete publication is repaired via the
  // recovery verb, then disposed normally.
  await suite.check('disposition: quarantined publication recovers, then drops exactly', async () => {
    const victim = await startAgentFork({
      ownerId: OWNER,
      runId: 'quarantine-run',
      purpose: 'interrupted-publication',
      ...forkOptions,
    });
    cleanups.push(() => victim.stop().catch(() => {}));
    // Simulate the crash-interrupted publication shape: the staging
    // sentinel survives inside the published directory.
    closeSync(openSync(join(victim.destination, STAGING_SENTINEL), 'w'));
    let quarantined = null;
    try {
      await victim.fork.diff();
    } catch (error) {
      quarantined = error;
    }
    assertEqual(quarantined?.code, 'SNAPBACK_FORK_PUBLICATION_PARTIAL',
      'a sentinel-bearing fork refuses inspection');
    const recovery = await recoverForkDestination({
      ...ownedOptions,
      destination: victim.destination,
    });
    assertEqual(recovery.disposition, 'published-recovered');
    const receipt = await victim.fork.diff();
    assertEqual(receipt.rows.length, 0, 'recovered fork inspects cleanly');
    await victim.stop();
    const remaining = await discoverOwnedForks({ ...ownedOptions, match: { ownerId: OWNER } });
    assertEqual(remaining.length, 0, 'nothing owned survives the full disposition matrix');
  });
}, { cleanups });
