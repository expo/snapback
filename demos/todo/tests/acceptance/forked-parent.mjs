// LLP 0158 F1: the shared acceptance harness can opt into a finite-TTL fork
// of realistic parent state instead of replacing that state with demo seed.

import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedDir = join(backendDir, 'generated');
const serverBinary = join(repoRoot, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ADA = 'user_ada';

const scratch = mkdtempSync(join(tmpdir(), 'snapback-fork-aware-acceptance-'));
const parentDir = join(scratch, 'parent');
const parentDb = join(parentDir, 'todo.sqlite3');
const forkRoot = join(scratch, 'forks');
mkdirSync(parentDir);

const suite = createSuite('todo / fork-aware parent state', { expectedChecks: 4 });
const cleanups = [() => rmSync(scratch, { recursive: true, force: true })];

await runAcceptance(suite, async () => {
  const initialParent = await startServer({
    port: 0,
    db: parentDb,
    cwd: repoRoot,
    serverBinary,
    provenance: { appId: 'todo', artifactsPath: join(generatedDir, 'artifacts.json') },
  });
  cleanups.push(() => initialParent.stop());
  const parentClient = new SnapbackClient(initialParent.baseUrl, initialParent.clientOptions);
  await parentClient.ensureApp({
    schema: readJson(join(generatedDir, 'schema.manifest.json')),
    functions: readJson(join(generatedDir, 'functions.manifest.json')),
    seed: readJson(join(backendDir, 'seed.json')),
  });
  await parentClient.mutate('createTodo', {
    args: { title: 'Parent-only production-shaped edge case' },
    userId: ADA,
  });
  await initialParent.stop();

  // This exact opt-in is the fork-instead-of-seed acceptance path. The helper
  // keeps the parent rows, loads this worktree's generated manifests, and
  // returns `close()` as an exact registry-bound `fork drop` cleanup.
  const app = await openHeadlessApp(import.meta.url, {
    appId: 'todo',
    forkFrom: parentDb,
    forkRoot,
    forkTtl: '10m',
    serverBinary,
  });
  cleanups.push(() => app.close());

  await suite.check('fork begins with realistic parent state instead of demo reseed', async () => {
    const rows = (await app.client.query('listTodos', { userId: ADA })).rows;
    assert(rows.some((row) => row.title === 'Parent-only production-shaped edge case'),
      'parent-only row was lost');
    assertEqual(rows.length, 4, 'fork should preserve three seeded Ada rows plus the parent edge case');
  });

  await suite.check('fork exposes finite, inert, deny-all lifecycle facts', async () => {
    const data = app.fork.createEnvelope.data;
    assert(typeof app.fork.forkId === 'string', 'fork id missing');
    assertEqual(data.receipt.lineage.promotable, false, 'local fork must be non-promotable');
    assertEqual(data.workerPolicy, { cron: 'disabled', jobs: 'disabled', assets: 'disabled' });
    assertEqual(data.egressPolicy, 'deny-all-v1');
    assertEqual(data.secrets, 'scrubbed');
  });

  const forkOnlyTitle = 'Fork-only worktree result';
  await app.client.mutate('createTodo', { args: { title: forkOnlyTitle }, userId: ADA });
  await suite.check('fork diff is a bounded app-row review receipt', async () => {
    const receipt = await app.fork.diff();
    assertEqual(receipt.rows.length, 1, 'one fork-only app-row mutation');
    assertEqual(receipt.rows[0].postImage.title, forkOnlyTitle, 'diff post-image');
    assert(receipt.omissions.includes('auth and credential state'), 'diff must retain explicit omissions');
  });

  const reopenedParentServer = await startServer({
    port: 0,
    db: parentDb,
    cwd: repoRoot,
    serverBinary,
    provenance: { appId: 'todo', artifactsPath: join(generatedDir, 'artifacts.json') },
  });
  cleanups.push(() => reopenedParentServer.stop());
  const reopenedParent = new SnapbackClient(
    reopenedParentServer.baseUrl,
    reopenedParentServer.clientOptions,
  );
  await reopenedParent.ensureApp({
    schema: readJson(join(generatedDir, 'schema.manifest.json')),
    functions: readJson(join(generatedDir, 'functions.manifest.json')),
  });
  await suite.check('fork writes stay invisible to the live parent', async () => {
    const rows = (await reopenedParent.query('listTodos', { userId: ADA })).rows;
    assert(!rows.some((row) => row.title === forkOnlyTitle), 'fork-only row leaked into parent');
    assert(rows.some((row) => row.title === 'Parent-only production-shaped edge case'),
      'parent edge case disappeared');
  });
}, { cleanups });
