import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertCleanTree,
  assertHoldingTag,
  awaitExactVersionPropagation,
  ceremonyArgv,
  defaultContinueInWorktree,
  deriveHoldingTag,
  inspectSourceTree,
  parseArguments,
  preflight,
  provisionIsolatedWorktree,
  releasePass,
  runCeremony,
  stagePass,
  teardownIsolatedWorktree,
} from './snapback-fastpath-release.mjs';

function createFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-fastpath-fixture-'));
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  };
  git(['init', '--quiet']);
  git(['config', 'user.email', 'fastpath@example.test']);
  git(['config', 'user.name', 'Fastpath Fixture']);
  writeFileSync(join(root, 'README'), 'fixture\n');
  git(['add', 'README']);
  git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'init']);
  return { root, git };
}

function dirtyRun(commands) {
  return (command, args) => {
    commands.push([command, ...args]);
    if (command === 'git' && args[0] === 'status') {
      return { status: 0, stdout: ' M dirty\n', stderr: '', error: null };
    }
    throw new Error(`unexpected spawn: ${command} ${args.join(' ')}`);
  };
}

test('stage and release arguments parse without side effects', () => {
  const stage = parseArguments([
    'stage', '--version', '0.1.17', '--out', 'candidate', '--runtime-platforms', 'all',
  ]);
  assert.equal(stage.subcommand, 'stage');
  assert.equal(stage.version, '0.1.17');
  assert.equal(stage.runtimePlatforms, 'all');
  assert.equal(stage.isolateWorktree, true);

  const release = parseArguments([
    'release', '--version', '0.1.17', '--out', 'candidate',
    '--receipt', 'darwin-arm64=darwin.json',
    '--receipt', 'linux-x64=linux.json',
    '--retain-ledger', 'retained.json',
    '--publish', '--otp', '123456',
  ]);
  assert.equal(release.subcommand, 'release');
  assert.equal(release.receipts.size, 2);
  assert.equal(release.publish, true);
  assert.equal(release.otp, '123456');
  assert.equal(release.isolateWorktree, true);
  assert.equal(
    parseArguments([
      'stage', '--version', '0.1.17', '--no-isolate-worktree',
    ]).isolateWorktree,
    false,
  );

  const inspected = parseArguments(['preflight']);
  assert.equal(inspected.subcommand, 'preflight');
  assert.equal(inspected.isolateWorktree, false);

  assert.throws(
    () => parseArguments(['stage', '--version', 'latest']),
    (error) => error.code === 'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
  );
  assert.throws(
    () => parseArguments(['stage', '--version', '01.2.3']),
    (error) => error.code === 'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
  );
  assert.throws(
    () => parseArguments(['preflight', '--version', '0.1.17']),
    (error) => error.code === 'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
  );
});

test('release refuses an incomplete receipt matrix', () => {
  assert.throws(
    () => parseArguments([
      'release', '--version', '0.1.17',
      '--receipt', 'darwin-arm64=darwin.json',
    ]),
    (error) => error.code === 'SNAPBACK_FASTPATH_STORE_RECEIPT_MISSING',
  );
});

test('holding tag is derived from exact version and source revision', () => {
  assert.equal(
    deriveHoldingTag('0.1.17', 'abcdef0123456789abcdef0123456789abcdef01'),
    'fastpath-0-1-17-abcdef012345',
  );
});

test('latest is never accepted as a holding tag', () => {
  assert.throws(
    () => assertHoldingTag('latest'),
    (error) => error.code === 'SNAPBACK_FASTPATH_HOLDING_TAG_INVALID',
  );
});

test('exact-version propagation waits for a lagging read replica', async () => {
  const packages = [
    { name: '@expo/snapback-cli', version: '0.1.17' },
    { name: '@expo/snapback-client', version: '0.1.17' },
  ];
  let probe = 0;
  const clock = { value: 0 };
  const summary = await awaitExactVersionPropagation(packages, {
    deadlineMs: 60_000,
    pollMs: 1_000,
    // The cli name answers ETARGET on the first sweep, exactly as the real
    // 0.1.17 cut did, and resolves on the second.
    exists: (name) => {
      if (name !== '@expo/snapback-cli') return true;
      probe += 1;
      return probe > 1;
    },
    now: () => clock.value,
    wait: async (ms) => { clock.value += ms; },
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.resolved.length, 2);
  assert.equal(summary.waitedMs, 1_000);
});

test('exact-version propagation fails closed on a genuinely absent version', async () => {
  const clock = { value: 0 };
  await assert.rejects(
    () => awaitExactVersionPropagation([{ name: '@expo/snapback-cli', version: '9.9.9' }], {
      deadlineMs: 10_000,
      pollMs: 1_000,
      exists: () => false,
      now: () => clock.value,
      wait: async (ms) => { clock.value += ms; },
    }),
    (error) => error.code === 'SNAPBACK_FASTPATH_REGISTRY_PROPAGATION_TIMEOUT',
  );
});

test('preflight inspects cleanliness and HEAD without ceremony work', () => {
  const fixture = createFixtureRepo();
  try {
    const clean = preflight({}, { cwd: fixture.root });
    assert.equal(clean.ok, true);
    assert.equal(clean.dirty, false);
    assert.equal(clean.revision, fixture.git(['rev-parse', 'HEAD']));

    writeFileSync(join(fixture.root, 'uncommitted.log'), 'dirty\n');
    assert.throws(
      () => preflight({}, { cwd: fixture.root }),
      (error) => error.code === 'SNAPBACK_FASTPATH_DIRTY_TREE'
        && error.details?.revision === clean.revision,
    );
    assert.equal(inspectSourceTree({ cwd: fixture.root }).dirty, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('dirty stage and release spawn no publish or qualify child', async () => {
  const stageCommands = [];
  await assert.rejects(
    () => stagePass({
      subcommand: 'stage',
      version: '0.1.20',
      out: '/tmp/fastpath-out',
      isolateWorktree: false,
    }, { run: dirtyRun(stageCommands) }),
    (error) => error.code === 'SNAPBACK_FASTPATH_DIRTY_TREE',
  );
  assert.deepEqual(stageCommands, [['git', 'status', '--porcelain']]);

  const releaseCommands = [];
  await assert.rejects(
    () => releasePass({
      subcommand: 'release',
      version: '0.1.20',
      out: '/tmp/fastpath-out',
      isolateWorktree: false,
      receipts: new Map([
        ['darwin-arm64', '/tmp/darwin.json'],
        ['linux-x64', '/tmp/linux.json'],
      ]),
    }, { run: dirtyRun(releaseCommands) }),
    (error) => error.code === 'SNAPBACK_FASTPATH_DIRTY_TREE',
  );
  assert.deepEqual(releaseCommands, [['git', 'status', '--porcelain']]);

  const ceremonyCommands = [];
  await assert.rejects(
    () => runCeremony({
      subcommand: 'stage',
      version: '0.1.20',
      out: '/tmp/fastpath-out',
      isolateWorktree: false,
    }, { run: dirtyRun(ceremonyCommands) }),
    (error) => error.code === 'SNAPBACK_FASTPATH_DIRTY_TREE',
  );
  assert.deepEqual(ceremonyCommands, [['git', 'status', '--porcelain']]);
});

test('dirty invoking checkout with default isolate proceeds via a clean worktree', async () => {
  const fixture = createFixtureRepo();
  const revision = fixture.git(['rev-parse', 'HEAD']);
  writeFileSync(join(fixture.root, 'uncommitted.log'), 'dirty shared checkout\n');
  assert.equal(inspectSourceTree({ cwd: fixture.root }).dirty, true);

  let continued = null;
  try {
    const result = await runCeremony({
      subcommand: 'stage',
      version: '0.1.20',
      out: join(fixture.root, 'out'),
      isolateWorktree: true,
      runtimePlatforms: 'all',
      receipts: new Map(),
    }, {
      cwd: fixture.root,
      continueInWorktree: async ({ worktree, invoking }) => {
        continued = worktree;
        assert.equal(invoking.dirty, true);
        assert.equal(worktree.revision, revision);
        const isolated = inspectSourceTree({ cwd: worktree.path });
        assert.equal(isolated.dirty, false);
        assert.equal(isolated.revision, revision);
        assert.equal(existsSync(join(worktree.path, 'uncommitted.log')), false);
        return { ok: true, version: '0.1.20', revision };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.isolatedWorktree.retained, false);
    assert.equal(existsSync(continued.path), false);
  } finally {
    if (continued?.path && existsSync(continued.path)) {
      teardownIsolatedWorktree({ path: continued.path, cwd: fixture.root });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('failed isolated ceremony retains the worktree path', async () => {
  const fixture = createFixtureRepo();
  writeFileSync(join(fixture.root, 'uncommitted.log'), 'dirty\n');
  let retained = null;
  try {
    await assert.rejects(
      () => runCeremony({
        subcommand: 'release',
        version: '0.1.20',
        out: join(fixture.root, 'out'),
        isolateWorktree: true,
        receipts: new Map([
          ['darwin-arm64', '/tmp/darwin.json'],
          ['linux-x64', '/tmp/linux.json'],
        ]),
      }, {
        cwd: fixture.root,
        continueInWorktree: async ({ worktree }) => {
          retained = worktree;
          const error = new Error('injected isolate failure');
          error.code = 'SNAPBACK_FASTPATH_PASS2_FAILED';
          throw error;
        },
      }),
      (error) => error.code === 'SNAPBACK_FASTPATH_PASS2_FAILED'
        && error.details?.isolatedWorktree?.retained === true
        && error.details.isolatedWorktree.path === retained.path,
    );
    assert.equal(existsSync(retained.path), true);
    assert.equal(inspectSourceTree({ cwd: retained.path }).dirty, false);
  } finally {
    if (retained?.path && existsSync(retained.path)) {
      teardownIsolatedWorktree({ path: retained.path, cwd: fixture.root });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('default re-exec continues from the isolated script with isolate off', () => {
  const spawned = [];
  const result = defaultContinueInWorktree({
    worktree: { path: '/tmp/snapback-fastpath-wt', revision: 'abc123' },
    options: {
      subcommand: 'stage',
      version: '0.1.20',
      out: '/abs/out',
      runtimePlatforms: 'all',
    },
    spawn: (command, args, options) => {
      spawned.push({ command, args, cwd: options.cwd, env: options.env });
      return { status: 0, stdout: '{"ok":true}\n', stderr: '', error: null };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cwd, '/tmp/snapback-fastpath-wt');
  assert.equal(
    spawned[0].args[0],
    '/tmp/snapback-fastpath-wt/scripts/snapback-fastpath-release.mjs',
  );
  assert.equal(spawned[0].args.at(-1), '--no-isolate-worktree');
  assert.equal(
    spawned[0].env.SNAPBACK_FASTPATH_ISOLATED_WORKTREE,
    '/tmp/snapback-fastpath-wt',
  );
});

test('default re-exec rejects exit zero without a JSON result', () => {
  assert.throws(
    () => defaultContinueInWorktree({
      worktree: { path: '/tmp/snapback-fastpath-wt', revision: 'abc123' },
      options: {
        subcommand: 'stage',
        version: '0.1.20',
        out: '/abs/out',
        runtimePlatforms: 'all',
      },
      spawn: () => ({ status: 0, stdout: '', stderr: '', error: null }),
    }),
    (error) => error.code === 'SNAPBACK_FASTPATH_ISOLATE_FAILED'
      && error.details?.stdout === '',
  );
});

test('CLI entry runs when the script path has a symlinked ancestor', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-fastpath-symlink-'));
  const scriptsAlias = join(root, 'symlinked-scripts');
  symlinkSync(dirname(fileURLToPath(import.meta.url)), scriptsAlias, 'dir');
  try {
    const result = spawnSync(process.execPath, [
      join(scriptsAlias, 'snapback-fastpath-release.mjs'),
      'stage',
      '--help',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^usage:\n  node scripts\/snapback-fastpath-release\.mjs/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isolated re-exec argv disables isolate and keeps absolute outputs', () => {
  const argv = ceremonyArgv({
    subcommand: 'release',
    version: '0.1.20',
    out: '/abs/out',
    receipts: new Map([
      ['darwin-arm64', '/abs/darwin.json'],
      ['linux-x64', '/abs/linux.json'],
    ]),
    retainLedger: '/abs/ledger.json',
    publish: true,
    otp: '123456',
  });
  assert.deepEqual(argv.slice(0, 4), ['release', '--version', '0.1.20', '--out']);
  assert.equal(argv.at(-1), '--no-isolate-worktree');
  assert.ok(argv.includes('/abs/out'));
});

test('assertCleanTree is the exported preflight primitive', () => {
  const commands = [];
  assert.throws(
    () => assertCleanTree({ run: dirtyRun(commands) }),
    (error) => error.code === 'SNAPBACK_FASTPATH_DIRTY_TREE',
  );
  assert.deepEqual(commands, [['git', 'status', '--porcelain']]);
});

test('provisioned isolated worktree is a clean detached HEAD', () => {
  const fixture = createFixtureRepo();
  const revision = fixture.git(['rev-parse', 'HEAD']);
  writeFileSync(join(fixture.root, 'uncommitted.log'), 'dirty\n');
  let worktree = null;
  try {
    worktree = provisionIsolatedWorktree({ revision, cwd: fixture.root });
    assert.equal(worktree.revision, revision);
    assert.equal(inspectSourceTree({ cwd: worktree.path }).dirty, false);
    assert.match(worktree.path, /snapback-fastpath-/);
  } finally {
    if (worktree?.path && existsSync(worktree.path)) {
      teardownIsolatedWorktree({ path: worktree.path, cwd: fixture.root });
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
