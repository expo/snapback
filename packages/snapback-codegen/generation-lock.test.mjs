import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateInProcess } from './index.mjs';
import { verifyGeneratedGraph } from './review-surface.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const codegenUrl = pathToFileURL(join(packageRoot, 'index.mjs')).href;
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const LOCK_FILE = '.generated.regenerate.lock';

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

async function waitForFile(path, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`holder exited before creating ${path}`);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await wait(10);
  }
}

function makeBackend(prefix) {
  const project = mkdtempSync(join(tmpdir(), prefix));
  const backend = join(project, 'snapback');
  mkdirSync(backend);
  writeFileSync(
    join(project, 'demo.snapback.json'),
    `${JSON.stringify({ id: 'generation-lock-fixture' }, null, 2)}\n`,
  );
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  items: defineTable({ value: v.string() })
    .index('by_value', ['value'])
    .visibility({ kind: 'public-read' })
    .sync(),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { asc, defineLiveQuery } from '${defineUrl}';
export const listItems = defineLiveQuery({
  table: 'items',
  args: {},
  index: 'by_value',
  order: [asc('value')],
});
`);
  return { project, backend };
}

function spawnEval(source, args) {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source, ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, exited };
}

function generatedSwapHolderSource() {
  return `
import { existsSync, writeFileSync } from 'node:fs';
import { generateInProcess } from ${JSON.stringify(codegenUrl)};
const [backend, entered, release] = process.argv.slice(1);
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const result = await generateInProcess(backend, {}, {
  publication: {
    afterMaterializedBackup(paths) {
      writeFileSync(entered, JSON.stringify(paths) + '\\n');
      while (!existsSync(release)) Atomics.wait(sleepCell, 0, 0, 10);
    },
  },
});
process.stdout.write(JSON.stringify(result));
`;
}

function crashedLockHolderSource() {
  return `
import { writeFileSync } from 'node:fs';
import { generateInProcess } from ${JSON.stringify(codegenUrl)};
const [backend, entered] = process.argv.slice(1);
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
await generateInProcess(backend, {}, {
  generationLock: {
    afterAcquire({ lockPath }) {
      writeFileSync(entered, lockPath + '\\n');
      for (;;) Atomics.wait(sleepCell, 0, 0, 1_000);
    },
  },
});
`;
}

test('overlapping regenerations serialize across the generated-directory rename window', async () => {
  const { project, backend } = makeBackend('snapback-generation-lock-race-');
  const entered = join(project, 'first-entered-swap');
  const release = join(project, 'release-first-swap');
  let holder = null;
  try {
    const baseline = await generateInProcess(backend);
    assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
    assert.equal(existsSync(join(backend, LOCK_FILE)), false, 'one-shot generation releases its lock');

    holder = spawnEval(generatedSwapHolderSource(), [backend, entered, release]);
    await waitForFile(entered, holder.child);
    const publicationPaths = JSON.parse(readFileSync(entered, 'utf8'));
    for (const path of [publicationPaths.backupDir, publicationPaths.tmpDir]) {
      assert.match(
        relative(project, path),
        /^\.\.(?:[/\\]|$)/u,
        `publication staging must remain outside the Metro project tree: ${path}`,
      );
    }
    assert.equal(publicationPaths.outDir, join(realpathSync(backend), 'generated'));

    let reportBlocked;
    const blocked = new Promise((resolve) => { reportBlocked = resolve; });
    const secondPromise = generateInProcess(backend, {}, {
      generationLock: { onBlocked: reportBlocked },
    });
    const firstObservation = await Promise.race([
      blocked.then(() => 'blocked'),
      secondPromise.then(() => 'second-completed'),
      wait(10_000).then(() => 'timed-out'),
    ]);
    writeFileSync(release, 'release\n');

    const [second, firstExit] = await Promise.all([secondPromise, holder.exited]);
    holder = null;
    assert.equal(firstExit.code, 0, firstExit.stderr);
    const first = JSON.parse(firstExit.stdout);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.equal(firstObservation, 'blocked', 'the second writer waits before entering codegen');
    assert.equal(first.inputsHash, second.inputsHash);

    const verified = verifyGeneratedGraph(join(backend, 'generated'));
    assert.equal(verified.manifest.inputsHash, first.inputsHash);
    assert.equal(
      readFileSync(join(backend, 'generated', 'artifacts.json'), 'utf8'),
      readFileSync(join(verified.graphRoot, 'artifacts.json'), 'utf8'),
      'the final materialization and content-addressed graph agree',
    );
    assert.deepEqual(
      readdirSync(backend).filter((name) => name.startsWith('.generated') || name.startsWith('generated.bak-')),
      [],
      'no lock, staging directory, or backup remains',
    );
  } finally {
    writeFileSync(release, 'release\n');
    if (holder?.child.exitCode === null && holder?.child.signalCode === null) {
      holder.child.kill('SIGKILL');
      await holder.exited;
    }
    rmSync(project, { recursive: true, force: true });
  }
});

test('a killed lock holder is reclaimed by the next regeneration within a bounded wait', async () => {
  const { project, backend } = makeBackend('snapback-generation-lock-stale-');
  const entered = join(project, 'holder-acquired-lock');
  let holder = null;
  try {
    holder = spawnEval(crashedLockHolderSource(), [backend, entered]);
    await waitForFile(entered, holder.child);
    const lockPath = readFileSync(entered, 'utf8').trim();
    assert.equal(lockPath, join(realpathSync(backend), LOCK_FILE));
    assert.equal(existsSync(lockPath), true);

    holder.child.kill('SIGKILL');
    const killed = await holder.exited;
    holder = null;
    assert.equal(killed.signal, 'SIGKILL');
    assert.equal(existsSync(lockPath), true, 'SIGKILL leaves the advisory lock for stale recovery');

    const startedAt = Date.now();
    let acquiredAfterMs = null;
    const recovered = await generateInProcess(backend, {}, {
      generationLock: {
        afterAcquire() { acquiredAfterMs = Date.now() - startedAt; },
      },
    });
    assert.equal(recovered.ok, true, JSON.stringify(recovered.diagnostics));
    assert(acquiredAfterMs < 5_000, `dead-holder recovery took ${acquiredAfterMs}ms`);
    assert.equal(existsSync(lockPath), false);
    assert.equal(
      readdirSync(backend).some((name) => name.startsWith(`${LOCK_FILE}.stale-`)),
      false,
      'stale-lock quarantine is removed after takeover',
    );
    verifyGeneratedGraph(join(backend, 'generated'));
  } finally {
    if (holder?.child.exitCode === null && holder?.child.signalCode === null) {
      holder.child.kill('SIGKILL');
      await holder.exited;
    }
    rmSync(project, { recursive: true, force: true });
  }
});
