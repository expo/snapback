import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  cleanupAfterActiveSample, CUSTODY_LIMITATION, CUSTODY_SAMPLE_MS,
  ProcessCustody, parseProcessSnapshot, processSnapshot,
} from './run-pilot.mjs';

const UID = 501;
const LAUNCHER_PID = 50;
const LEADER_PID = 100;

function row(pid, { uid = UID, ppid = 1, pgid = pid, start = `start-${pid}`, command = `command-${pid}` } = {}) {
  return {
    pid, uid, ppid, pgid, startTime: start, startToken: `${pid}:${start}`,
    commandSha256: `sha256:${command}`,
  };
}

class MockKernel {
  constructor(rows) {
    this.rows = new Map(rows.map(processRow => [processRow.pid, { ...processRow }]));
    this.signals = [];
    this.ignore = new Map();
  }

  snapshot = async () => [...this.rows.values()].map(processRow => ({ ...processRow }));

  setIgnore(pid, ...signals) {
    this.ignore.set(pid, new Set(signals));
  }

  remove(pid) {
    this.rows.delete(pid);
    for (const processRow of this.rows.values()) {
      if (processRow.ppid === pid) processRow.ppid = 1;
    }
  }

  replace(processRow) {
    this.rows.set(processRow.pid, { ...processRow });
  }

  signalPid = async (pid, signal) => {
    this.signals.push({ target: 'pid', pid, signal });
    if (!this.rows.has(pid)) return;
    if (!this.ignore.get(pid)?.has(signal)) this.remove(pid);
  };

  signalGroup = async (pgid, signal) => {
    this.signals.push({ target: 'group', pgid, signal });
    for (const processRow of [...this.rows.values()]) {
      if (processRow.pgid === pgid && !this.ignore.get(processRow.pid)?.has(signal)) {
        this.remove(processRow.pid);
      }
    }
  };
}

function harness(kernel) {
  let tick = 0;
  const custody = new ProcessCustody({
    uid: UID,
    snapshot: kernel.snapshot,
    signalPid: kernel.signalPid,
    signalGroup: kernel.signalGroup,
    sleep: async () => {},
    now: () => `2026-09-16T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    timings: {
      pollMs: 0, gracefulMs: 0, groupTermMs: 0, groupKillMs: 0,
      descendantTermMs: 0, descendantKillMs: 0, pidTermMs: 0, pidKillMs: 0,
    },
  });
  custody.seedLeader(kernel.rows.get(LEADER_PID), {
    expectedPid: LEADER_PID, expectedPgid: LEADER_PID, launcherPid: LAUNCHER_PID,
  });
  custody.observeRows([...kernel.rows.values()], { adopt: true });
  return custody;
}

test('process snapshots retain every exact identity coordinate and hash', () => {
  assert.equal(CUSTODY_SAMPLE_MS, 5_000);
  const [identity] = parseProcessSnapshot(
    ' 72357 501 70000 72357 Wed Sep 16 12:34:56 2026 /opt/codex exec --json\n',
  );
  assert.deepEqual(
    { pid: identity.pid, uid: identity.uid, ppid: identity.ppid, pgid: identity.pgid },
    { pid: 72357, uid: 501, ppid: 70000, pgid: 72357 },
  );
  assert.equal(identity.startTime, 'Wed Sep 16 12:34:56 2026');
  assert.equal(identity.startToken, '72357:Wed Sep 16 12:34:56 2026');
  assert.match(identity.commandSha256, /^[0-9a-f]{64}$/);
});

test('command hash evolution is receipted without changing stable process identity', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200, command: 'before-exec' }),
  ]);
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  kernel.replace(row(200, { ppid: 1, pgid: 200, command: 'after-exec' }));
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  const adopted = receipt.adoptedIdentities.find(identity => identity.pid === 200);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.uncertainties.length, 0);
  assert.equal(adopted.commandSha256, 'sha256:before-exec');
  assert.equal(adopted.lastObserved.commandSha256, 'sha256:after-exec');
  assert.ok(receipt.events.some(event => event.event === 'identity-coordinates-changed'
    && event.identity.pid === 200
    && event.from.commandSha256 === 'sha256:before-exec'
    && event.to.commandSha256 === 'sha256:after-exec'));
  assert.ok(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === 200));
});

test('stop-time cleanup starts only after the active sample settles', async () => {
  const order = [];
  let finishSample;
  const activeSample = new Promise(resolveSample => { finishSample = resolveSample; })
    .then(() => { order.push('sample'); });
  const cleanup = cleanupAfterActiveSample(activeSample, async () => {
    order.push('cleanup');
    return 'done';
  });
  await Promise.resolve();
  assert.deepEqual(order, []);
  finishSample();
  assert.equal(await cleanup, 'done');
  assert.deepEqual(order, ['sample', 'cleanup']);
});

test('separate descendant PGID is adopted and cleaned after graceful Codex cancellation', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  const custody = harness(kernel);
  const receipt = await custody.cleanup({ reason: 'four-hour-operational-ceiling', intentional: true });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.gracefulCancellation.signal, 'SIGINT');
  assert.deepEqual(receipt.adoptedGroups.map(group => group.pgid), [200]);
  assert.ok(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === 200));
  assert.deepEqual(receipt.survivors, []);
});

test('child first visible during descendant-group TERM wait is adopted and drained', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  const signalGroup = kernel.signalGroup;
  kernel.signalGroup = async (pgid, signal) => {
    if (pgid === 200 && signal === 'SIGTERM') {
      kernel.signals.push({ target: 'group', pgid, signal });
      kernel.replace(row(300, { ppid: 200, pgid: 300 }));
      return;
    }
    await signalGroup(pgid, signal);
  };
  const custody = harness(kernel);
  const receipt = await custody.cleanup({ reason: 'four-hour-operational-ceiling', intentional: true });
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.adoptedGroups.map(group => group.pgid), [200, 300]);
  assert.ok(receipt.adoptedIdentities.some(identity => identity.pid === 300
    && identity.parentIdentity.pid === 200));
  assert.ok(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === 300));
  assert.deepEqual(receipt.survivors, []);
  assert.equal(kernel.rows.has(300), false);
});

test('leader exit does not lose custody of a surviving adopted child', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  assert.equal(receipt.ok, true);
  assert.ok(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === 200));
  assert.equal(kernel.rows.has(200), false);
});

test('verified adopted parent can extend custody after the original leader exited', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: LEADER_PID }),
  ]);
  const signalGroup = kernel.signalGroup;
  kernel.signalGroup = async (pgid, signal) => {
    if (pgid === LEADER_PID && signal === 'SIGTERM') {
      kernel.signals.push({ target: 'group', pgid, signal });
      kernel.replace(row(300, { ppid: 200, pgid: 300 }));
      return;
    }
    await signalGroup(pgid, signal);
  };
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  assert.equal(receipt.ok, true);
  assert.ok(receipt.adoptedIdentities.some(identity => identity.pid === 300
    && identity.parentIdentity.pid === 200));
  assert.deepEqual(receipt.adoptedGroups.map(group => group.pgid), [300]);
  assert.ok(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === 300));
  assert.deepEqual(receipt.survivors, []);
  assert.equal(kernel.rows.has(300), false);
});

test('TERM-ignore descendant group escalates to KILL', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  kernel.setIgnore(200, 'SIGTERM');
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  assert.equal(receipt.ok, true);
  assert.deepEqual(
    kernel.signals.filter(signal => signal.target === 'group' && signal.pgid === 200).map(signal => signal.signal),
    ['SIGTERM', 'SIGKILL'],
  );
});

test('post-spawn lifecycle exception cleans descendants and leader without graceful SIGINT', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  const custody = harness(kernel);
  const receipt = await custody.cleanup({ reason: 'lifecycle-error', intentional: false });
  assert.equal(receipt.ok, true);
  assert.equal(kernel.rows.size, 0);
  assert.equal(kernel.signals.some(signal => signal.signal === 'SIGINT'), false);
  assert.ok(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === LEADER_PID));
});

test('PID/start/UID mismatch is refused without signalling the mismatched process', async () => {
  for (const replacement of [
    { start: 'reused-start', uid: UID },
    { start: 'old-start', uid: 777 },
  ]) {
    const kernel = new MockKernel([
      row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
      row(200, { ppid: LEADER_PID, pgid: 200, start: 'old-start' }),
    ]);
    const custody = harness(kernel);
    kernel.remove(LEADER_PID);
    kernel.replace(row(200, { ppid: 1, pgid: 200, ...replacement }));
    const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
    assert.equal(receipt.ok, false);
    assert.ok(receipt.uncertainties.some(item => item.code === 'PILOT_PID_IDENTITY_CHANGED'));
    assert.equal(kernel.signals.some(signal => signal.pid === 200 || signal.pgid === 200), false);
    assert.equal(kernel.rows.has(200), true);
  }
});

test('group with unknown same-UID and foreign members is refused while the exact adopted PID is cleaned', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  kernel.replace(row(201, { uid: UID, ppid: 1, pgid: 200 }));
  kernel.replace(row(202, { uid: 777, ppid: 1, pgid: 200 }));
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  assert.equal(receipt.ok, false);
  assert.ok(receipt.uncertainties.some(item => item.code === 'PILOT_GROUP_HAS_UNKNOWN_MEMBER'));
  assert.equal(kernel.signals.some(signal => signal.target === 'group' && signal.pgid === 200), false);
  assert.ok(kernel.signals.some(signal => signal.target === 'pid' && signal.pid === 200));
  assert.equal(kernel.rows.has(201), true);
  assert.equal(kernel.rows.has(202), true);
});

test('natural leader exit cannot pass while an adopted survivor ignores TERM and KILL', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  kernel.setIgnore(200, 'SIGTERM', 'SIGKILL');
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  assert.equal(receipt.ok, false);
  assert.deepEqual(receipt.survivors.map(survivor => survivor.pid), [200]);
});

test('overall cleanup deadline includes graceful cancel and retains final survivor evidence', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
    row(200, { ppid: LEADER_PID, pgid: 200 }),
  ]);
  kernel.signalPid = async (pid, signal) => {
    kernel.signals.push({ target: 'pid', pid, signal });
    t.mock.timers.tick(24 * 60 * 60 * 1000);
  };
  kernel.signalGroup = async (pgid, signal) => {
    kernel.signals.push({ target: 'group', pgid, signal });
  };
  const custody = harness(kernel);
  const receipt = await custody.cleanup({ reason: 'four-hour-operational-ceiling', intentional: true });
  assert.equal(receipt.ok, false);
  assert.deepEqual(receipt.terminalCleanup, { limitMilliseconds: 30_000, exhausted: true });
  assert.equal(receipt.gracefulCancellation.outcome, 'cleanup-deadline-exhausted');
  assert.ok(receipt.uncertainties.some(
    uncertainty => uncertainty.code === 'PILOT_TERMINAL_CLEANUP_DEADLINE_EXHAUSTED',
  ));
  assert.deepEqual(receipt.survivors.map(survivor => survivor.pid), [LEADER_PID, 200]);
  assert.deepEqual(kernel.signals, [{ target: 'pid', pid: LEADER_PID, signal: 'SIGINT' }]);
});

test('fast double-fork gap is explicit and cold-cell evidence stays fail-closed', async () => {
  const kernel = new MockKernel([
    row(LEADER_PID, { ppid: LAUNCHER_PID, pgid: LEADER_PID }),
  ]);
  const custody = harness(kernel);
  kernel.remove(LEADER_PID);
  kernel.replace(row(300, { ppid: 1, pgid: 300 })); // Never appeared in a snapshot with an adopted PPID.
  const receipt = await custody.cleanup({ reason: 'leader-exited', intentional: false });
  assert.equal(receipt.limitation, CUSTODY_LIMITATION);
  assert.equal(receipt.custodyClaim, 'same-UID ancestry observed in bounded process snapshots only');
  assert.deepEqual(receipt.coldCellCoverage, {
    status: 'external-actual-codex-receipt-required', eligibleFromThisReceipt: false,
    reason: 'Actual-Codex ordinary exec-spawn/session coverage must pass before a cold cell.',
  });
  assert.equal(receipt.adoptedIdentities.some(identity => identity.pid === 300), false);
  assert.equal(kernel.rows.has(300), true);
});

test('actual Codex ordinary exec-spawn custody', {
  skip: process.env.WORKROOM_ACTUAL_CODEX_CUSTODY !== '1'
    ? 'set WORKROOM_ACTUAL_CODEX_CUSTODY=1 only for the required pre-cold-cell coverage run'
    : false,
  timeout: 180_000,
}, async () => {
  const receiptDir = resolve(process.env.WORKROOM_ACTUAL_CODEX_RECEIPT_DIR
    ?? '/tmp/workroom-actual-codex-custody');
  mkdirSync(receiptDir, { recursive: false, mode: 0o700 });
  const app = join(receiptDir, 'app');
  mkdirSync(app, { mode: 0o700 });
  const marker = join(receiptDir, 'fixture-child.json');
  const fixture = join(receiptDir, 'ordinary-exec-spawn.mjs');
  writeFileSync(fixture, [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: child.pid }) + '\\n');`,
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  const lastMessage = join(receiptDir, 'last-message.md');
  const command = ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox',
    '--ignore-user-config', '--skip-git-repo-check', '--json', '--color', 'never',
    '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=xhigh', '-C', app,
    '-o', lastMessage, '-'];
  const child = spawn(command[0], command.slice(1), {
    cwd: app, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.ok(child.pid);
  let stdoutText = '';
  let stderrText = '';
  child.stdout.on('data', chunk => { stdoutText += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderrText += chunk.toString('utf8'); });
  const closePromise = new Promise(resolveClose => child.once('close', resolveClose));
  const events = [];
  let coverageCleanupFinished = false;
  const custody = new ProcessCustody({
    uid: process.getuid(), snapshot: async () => processSnapshot(process.env),
    signalPid: async (pid, signal) => process.kill(pid, signal),
    signalGroup: async (pgid, signal) => process.kill(-pgid, signal),
    record: event => events.push(event),
  });
  try {
    const initial = await custody.snapshot();
    custody.seedLeader(initial.find(processRow => processRow.pid === child.pid), {
      expectedPid: child.pid, expectedPgid: child.pid, launcherPid: process.pid,
    });
    child.stdin.end([
      'This is a launcher custody coverage fixture. Do not browse, edit, or delegate.',
      `Run exactly this ordinary foreground shell command and wait for it: node ${fixture}`,
    ].join('\n'));
    const deadline = Date.now() + 120_000;
    let fixtureChildPid = null;
    while (Date.now() < deadline) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, CUSTODY_SAMPLE_MS));
      await custody.sample({ adopt: true });
      if (existsSync(marker)) fixtureChildPid = JSON.parse(readFileSync(marker, 'utf8')).pid;
      if (fixtureChildPid && custody.ledger.some(identity => identity.pid === fixtureChildPid
          && identity.pgid !== custody.leader.pgid)) break;
    }
    const receipt = await custody.cleanup({ reason: 'actual-codex-coverage-stop', intentional: true });
    coverageCleanupFinished = true;
    await Promise.race([closePromise, new Promise(resolveDelay => setTimeout(resolveDelay, 2_000))]);
    writeFileSync(join(receiptDir, 'codex.stdout.jsonl'), stdoutText, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(receiptDir, 'codex.stderr.log'), stderrText, { flag: 'wx', mode: 0o600 });
    const threadStarted = stdoutText.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).find(event => event?.type === 'thread.started');
    const threadId = threadStarted?.thread_id ?? threadStarted?.threadId ?? threadStarted?.id ?? null;
    const coverage = {
      kind: 'workroom-actual-codex-custody-coverage', recordedAt: new Date().toISOString(),
      command, threadId, fixtureChildPid, receipt, events,
      passed: typeof threadId === 'string' && receipt.ok && receipt.gracefulCancellation.attempted
        && receipt.adoptedIdentities.some(identity => identity.pid === fixtureChildPid)
        && receipt.adoptedGroups.some(group => group.members.some(member => member.pid === fixtureChildPid))
        && receipt.survivors.length === 0,
    };
    writeFileSync(join(receiptDir, 'coverage-receipt.json'), JSON.stringify(coverage, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    assert.equal(coverage.passed, true);
  } finally {
    if (!coverageCleanupFinished && custody.leader) {
      try { await custody.cleanup({ reason: 'actual-codex-coverage-test-error', intentional: true }); }
      catch { /* The failed receipt path must not broaden signalling beyond verified custody. */ }
    } else if (!coverageCleanupFinished && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000));
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null) child.unref();
  }
});
