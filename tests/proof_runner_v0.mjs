import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseGateCalls } from '../scripts/check-local-proof-gates.mjs';

const root = resolve(import.meta.dirname, '..');
const runner = join(root, 'scripts', 'lib', 'proof-runner.sh');

function selectedGateBytes(selected) {
  return selected.map((gateId) => `${gateId}\n`).join('');
}

function selectedGateDigest(selected) {
  return `sha256:${createHash('sha256').update(selectedGateBytes(selected)).digest('hex')}`;
}

function selectedGateIds(body) {
  return [...new Set(
    [...body.matchAll(/^\s*proof_gate\s+([a-z0-9-]+)/gmu)]
      .map((match) => match[1]),
  )];
}

function fixture(body, {
  keepGoing = 1,
  selected = selectedGateIds(body),
  captureSignatures = false,
  timeoutSeconds = null,
  termGraceSeconds = null,
  captureDrainSeconds = null,
  supervised = false,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-proof-runner-'));
  const receipt = join(scratch, 'results.jsonl');
  const selectedGates = join(scratch, 'selected-gates.txt');
  const marker = join(scratch, 'dependent-ran');
  const childPid = join(scratch, 'child.pid');
  const writerPid = join(scratch, 'writer.pid');
  const detachedWriter = join(scratch, 'detached-writer.py');
  const setsidChild = join(scratch, 'setsid-child.py');
  const signalCleanupGate = join(scratch, 'signal-cleanup-gate.mjs');
  const stdoutPath = join(scratch, 'fixture.stdout');
  const stderrPath = join(scratch, 'fixture.stderr');
  const proofBodyPath = join(scratch, 'proof-body.sh');
  writeFileSync(detachedWriter, `import os
import pathlib
import signal
import time

if os.fork() != 0:
    os._exit(0)
os.setsid()
if os.fork() != 0:
    os._exit(0)
os.environ.pop("SNAPBACK_PROOF_GATE_EXECUTION_TOKEN", None)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
pathlib.Path(os.environ["FIXTURE_WRITER_PID"]).write_text(str(os.getpid()))
time.sleep(60)
`);
  writeFileSync(setsidChild, `import os
import pathlib
import signal
import time

os.setsid()
signal.signal(signal.SIGTERM, signal.SIG_IGN)
devnull = os.open("/dev/null", os.O_RDWR)
os.dup2(devnull, 1)
os.dup2(devnull, 2)
pathlib.Path(os.environ["FIXTURE_CHILD_PID"]).write_text(str(os.getpid()))
time.sleep(60)
`);
  writeFileSync(signalCleanupGate, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { createSuite, runAcceptance } from ${JSON.stringify(join(root, 'demos', '_kit', 'harness.mjs'))};

const suite = createSuite('setsid signal cleanup fixture', { expectedChecks: 1 });
const cleanups = [];
await runAcceptance(suite, async () => {
  const child = spawn('python3', [process.env.FIXTURE_SETSID_CHILD], {
    env: process.env,
    stdio: 'ignore',
  });
  cleanups.push(async () => {
    const closed = new Promise((resolveClose) => child.once('close', resolveClose));
    try { process.kill(child.pid, 'SIGKILL'); } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await closed;
    writeFileSync(process.env.FIXTURE_MARKER, 'signal cleanup ran');
  });
  await new Promise(() => {});
}, { cleanups });
`);
  writeFileSync(selectedGates, selectedGateBytes(selected));
  const proofBody = `
set -euo pipefail
source ${JSON.stringify(runner)}
proof_runner_init fixture ${JSON.stringify(receipt)} ${keepGoing} ${JSON.stringify(selectedGates)} ${selected.length} ${JSON.stringify(selectedGateDigest(selected))}
${body}
proof_runner_finish
`;
  writeFileSync(proofBodyPath, proofBody);
  const script = supervised
    ? `
set -euo pipefail
source ${JSON.stringify(runner)}
proof_runner_supervise fixture -- /bin/bash ${JSON.stringify(proofBodyPath)}
`
    : proofBody;
  const env = {
    ...process.env,
    FIXTURE_MARKER: marker,
    FIXTURE_SELECTED_GATES: selectedGates,
    FIXTURE_CHILD_PID: childPid,
    FIXTURE_WRITER_PID: writerPid,
    FIXTURE_DETACHED_WRITER: detachedWriter,
    FIXTURE_SETSID_CHILD: setsidChild,
    FIXTURE_SIGNAL_CLEANUP_GATE: signalCleanupGate,
    SNAPBACK_PROOF_CAPTURE_FAILURE_SIGNATURES: captureSignatures ? '1' : '0',
  };
  delete env.SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS;
  delete env.SNAPBACK_PROOF_GATE_TERM_GRACE_SECONDS;
  delete env.SNAPBACK_PROOF_CAPTURE_DRAIN_SECONDS;
  if (timeoutSeconds !== null) {
    env.SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS = String(timeoutSeconds);
  }
  if (termGraceSeconds !== null) {
    env.SNAPBACK_PROOF_GATE_TERM_GRACE_SECONDS = String(termGraceSeconds);
  }
  if (captureDrainSeconds !== null) {
    env.SNAPBACK_PROOF_CAPTURE_DRAIN_SECONDS = String(captureDrainSeconds);
  }
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  const startedAt = Date.now();
  let spawned;
  try {
    spawned = spawnSync('/bin/bash', ['-c', script], {
      cwd: root,
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
      timeout: 15_000,
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const result = {
    ...spawned,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  };
  const records = existsSync(receipt)
    ? readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  return {
    scratch,
    receipt,
    marker,
    childPid,
    writerPid,
    result,
    records,
    elapsedMs: Date.now() - startedAt,
  };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

test('init rejects path aliasing without overwriting the selected inventory', () => {
  const selected = ['first-gate', 'second-gate'];
  for (const variant of ['alias', 'symlink', 'hardlink']) {
    const scratch = mkdtempSync(join(tmpdir(), `snapback-proof-runner-${variant}-`));
    const selectedGates = join(scratch, 'selected-gates.txt');
    const results = variant === 'alias' ? selectedGates : join(scratch, 'results.jsonl');
    const original = selectedGateBytes(selected);
    writeFileSync(selectedGates, original);
    if (variant === 'symlink') symlinkSync(selectedGates, results);
    if (variant === 'hardlink') linkSync(selectedGates, results);
    const script = `
set -euo pipefail
source ${JSON.stringify(runner)}
proof_runner_init fixture ${JSON.stringify(results)} 1 ${JSON.stringify(selectedGates)} ${selected.length} ${JSON.stringify(selectedGateDigest(selected))}
`;
    const result = spawnSync('/bin/bash', ['-c', script], {
      cwd: root,
      encoding: 'utf8',
    });
    try {
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /selected-gates and results paths must not alias/u);
      assert.equal(readFileSync(selectedGates, 'utf8'), original);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});

test('init rejects descriptor pseudo-paths for selected and results artifacts', () => {
  const selected = ['first-gate'];
  for (const pseudoArtifact of ['selected', 'results']) {
    const scratch = mkdtempSync(join(tmpdir(), `snapback-proof-runner-fd-${pseudoArtifact}-`));
    const selectedGates = join(scratch, 'selected-gates.txt');
    const results = join(scratch, 'results.jsonl');
    const original = selectedGateBytes(selected);
    writeFileSync(selectedGates, original);
    const selectedArgument = pseudoArtifact === 'selected' ? '/dev/fd/7' : selectedGates;
    const resultsArgument = pseudoArtifact === 'results' ? '/dev/fd/7' : results;
    const script = `
set -euo pipefail
source ${JSON.stringify(runner)}
exec 7< ${JSON.stringify(selectedGates)}
proof_runner_init fixture ${JSON.stringify(resultsArgument)} 1 ${JSON.stringify(selectedArgument)} ${selected.length} ${JSON.stringify(selectedGateDigest(selected))}
`;
    const result = spawnSync('/bin/bash', ['-c', script], {
      cwd: root,
      encoding: 'utf8',
    });
    try {
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /descriptor pseudo-paths are forbidden/u);
      assert.equal(readFileSync(selectedGates, 'utf8'), original);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});

test('init rejects truncated prefixes and same-count id substitution', () => {
  const selected = ['first-gate', 'second-gate'];
  for (const variant of ['truncated', 'substituted']) {
    const scratch = mkdtempSync(join(tmpdir(), `snapback-proof-runner-${variant}-`));
    const selectedGates = join(scratch, 'selected-gates.txt');
    const results = join(scratch, 'results.jsonl');
    writeFileSync(
      selectedGates,
      selectedGateBytes(
        variant === 'truncated' ? selected.slice(0, 1) : ['first-gate', 'different-gate'],
      ),
    );
    const script = `
set -euo pipefail
source ${JSON.stringify(runner)}
proof_runner_init fixture ${JSON.stringify(results)} 1 ${JSON.stringify(selectedGates)} ${selected.length} ${JSON.stringify(selectedGateDigest(selected))}
`;
    const result = spawnSync('/bin/bash', ['-c', script], {
      cwd: root,
      encoding: 'utf8',
    });
    try {
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.match(
        result.stderr,
        variant === 'truncated' ? /selected gate count mismatch/u : /selected gate digest mismatch/u,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});

test('runtime selection membership remains authoritative after the source file changes', () => {
  const run = fixture(`
: > "$FIXTURE_SELECTED_GATES"
proof_gate selected-gate -- /usr/bin/true
`, { selected: ['selected-gate'] });
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.deepEqual(
      run.records.map(({ gateId, state }) => [gateId, state]),
      [['selected-gate', 'PASS']],
    );
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('policy NOT_SELECTED rejects a gate present in the selected snapshot', () => {
  const run = fixture(`
proof_not_selected selected-gate "attempted policy bypass"
`, { selected: ['selected-gate'] });
  try {
    assert.equal(run.result.status, 2, `${run.result.stdout}\n${run.result.stderr}`);
    assert.match(run.result.stderr, /policy NOT_SELECTED cannot reconcile selected gate selected-gate/u);
    assert.deepEqual(run.records, []);
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('gate-local exit/exec are recorded while outer supervision catches every top-level exit/exec form', () => {
  const gateExit = fixture(`
proof_gate selected-gate -- exit 0
`, { selected: ['selected-gate'], supervised: true });
  const gateExec = fixture(`
proof_gate selected-gate -- exec /usr/bin/true
`, { selected: ['selected-gate'], supervised: true });
  const topLevelExit = fixture(`
exit 0
`, { selected: ['selected-gate'], supervised: true });
  const topLevelExec = fixture(`
exec /usr/bin/true
`, { selected: ['selected-gate'], supervised: true });
  const topLevelBuiltinExec = fixture(`
builtin 'exec' /usr/bin/true
`, { selected: ['selected-gate'], supervised: true });
  const topLevelDynamicBuiltinExec = fixture(`
e=exec
builtin "$e" /usr/bin/true
`, { selected: ['selected-gate'], supervised: true });
  const topLevelMismatchedTokenExec = fixture(`
printf '{}\n' > "$PROOF_RUNNER_COMPLETION_PATH"
builtin 'exec' /usr/bin/true
`, { selected: ['selected-gate'], supervised: true });
  try {
    assert.equal(gateExit.result.status, 0, gateExit.result.stderr);
    assert.deepEqual(
      gateExit.records.map(({ gateId, state, exitCode }) => [gateId, state, exitCode]),
      [['selected-gate', 'PASS', 0]],
    );
    assert.equal(gateExec.result.status, 0, gateExec.result.stderr);
    assert.deepEqual(
      gateExec.records.map(({ gateId, state, exitCode }) => [gateId, state, exitCode]),
      [['selected-gate', 'PASS', 0]],
    );
    assert.equal(topLevelExit.result.status, 2, topLevelExit.result.stderr);
    assert.match(
      topLevelExit.result.stderr,
      /terminated before successful reconciliation \(phase: declarations\)/u,
    );
    assert.deepEqual(topLevelExit.records, []);
    assert.equal(topLevelExec.result.status, 2, topLevelExec.result.stderr);
    assert.match(topLevelExec.result.stderr, /did not produce a matching completion token/u);
    assert.deepEqual(topLevelExec.records, []);
    assert.equal(topLevelBuiltinExec.result.status, 2, topLevelBuiltinExec.result.stderr);
    assert.match(topLevelBuiltinExec.result.stderr, /did not produce a matching completion token/u);
    assert.deepEqual(topLevelBuiltinExec.records, []);
    assert.equal(topLevelDynamicBuiltinExec.result.status, 2, topLevelDynamicBuiltinExec.result.stderr);
    assert.match(topLevelDynamicBuiltinExec.result.stderr, /did not produce a matching completion token/u);
    assert.deepEqual(topLevelDynamicBuiltinExec.records, []);
    assert.equal(topLevelMismatchedTokenExec.result.status, 2, topLevelMismatchedTokenExec.result.stderr);
    assert.match(topLevelMismatchedTokenExec.result.stderr, /did not produce a matching completion token/u);
    assert.deepEqual(topLevelMismatchedTokenExec.records, []);
  } finally {
    rmSync(gateExit.scratch, { recursive: true, force: true });
    rmSync(gateExec.scratch, { recursive: true, force: true });
    rmSync(topLevelExit.scratch, { recursive: true, force: true });
    rmSync(topLevelExec.scratch, { recursive: true, force: true });
    rmSync(topLevelBuiltinExec.scratch, { recursive: true, force: true });
    rmSync(topLevelDynamicBuiltinExec.scratch, { recursive: true, force: true });
    rmSync(topLevelMismatchedTokenExec.scratch, { recursive: true, force: true });
  }
});

test('function-valued gates propagate an early command failure even when a later command succeeds', () => {
  for (const captureSignatures of [false, true]) {
    const run = fixture(`
false_then_true() {
  false
  true
}
proof_gate selected-gate -- false_then_true
`, { selected: ['selected-gate'], captureSignatures });
    try {
      assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
      assert.deepEqual(
        run.records.map(({ gateId, state, exitCode }) => [gateId, state, exitCode]),
        [['selected-gate', 'FAIL', 1]],
      );
      assert.equal(
        /^sha256:[0-9a-f]{64}$/u.test(run.records[0].failureSignature ?? ''),
        captureSignatures,
      );
    } finally {
      rmSync(run.scratch, { recursive: true, force: true });
    }
  }
});

test('finish rejects a selected gate hidden behind a false guard and accepts it unguarded', () => {
  const selected = ['guarded-gate'];
  const guarded = fixture(`
if false; then
  proof_gate guarded-gate -- /usr/bin/true
fi
`, { selected });
  const unguarded = fixture(`
proof_gate guarded-gate -- /usr/bin/true
`, { selected });
  try {
    assert.notEqual(guarded.result.status, 0, guarded.result.stdout);
    assert.match(guarded.result.stderr, /missing selected gate id\(s\): guarded-gate/u);
    assert.deepEqual(guarded.records, []);
    assert.equal(unguarded.result.status, 0, unguarded.result.stderr);
    assert.deepEqual(
      unguarded.records.map(({ gateId, state }) => [gateId, state]),
      [['guarded-gate', 'PASS']],
    );
  } finally {
    rmSync(guarded.scratch, { recursive: true, force: true });
    rmSync(unguarded.scratch, { recursive: true, force: true });
  }
});

test('fail-fast preserves the root command exit and never reaches later gates', () => {
  const run = fixture(`
proof_gate producer -- /bin/bash -c 'exit 23'
proof_gate never-reached -- /bin/bash -c 'touch "$FIXTURE_MARKER"'
`, { keepGoing: 0 });
  try {
    assert.equal(run.result.status, 23, run.result.stderr);
    assert.equal(existsSync(run.marker), false);
    assert.deepEqual(
      run.records.map(({ gateId, state, exitCode, terminationReason }) => (
        [gateId, state, exitCode, terminationReason]
      )),
      [['producer', 'FAIL', 23, 'exit']],
    );
    assert.doesNotMatch(
      `${run.result.stdout}\n${run.result.stderr}`,
      /SNAPBACK_PROOF_GATE_TIMEOUT/u,
      'an ordinary command failure must not be labeled as a timeout',
    );
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('a timed-out gate records exit 124 and kills a TERM-surviving snapback_server descendant', () => {
  const run = fixture(`
proof_gate hanging --timeout-seconds 1 -- /bin/bash -c '
trap "exit 0" TERM
node -e "process.title = \\\"snapback_server-timeout-fixture\\\"; process.on(\\\"SIGTERM\\\", () => {}); require(\\\"fs\\\").writeFileSync(process.env.FIXTURE_CHILD_PID, String(process.pid)); setInterval(() => {}, 1000)" &
wait
'
`, { captureSignatures: true, termGraceSeconds: 1 });
  let child;
  try {
    assert.notEqual(run.result.signal, 'SIGTERM', 'the outer fixture watchdog fired');
    assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
    assert.equal(run.records.length, 1);
    assert.deepEqual(
      run.records.map(({ gateId, state, exitCode, terminationReason }) => (
        [gateId, state, exitCode, terminationReason]
      )),
      [['hanging', 'FAIL', 124, 'timeout']],
    );
    assert.match(
      run.result.stderr,
      /SNAPBACK_PROOF_GATE_TIMEOUT: gate=hanging timeout_seconds=1 signal=TERM/u,
    );
    assert.match(
      run.result.stderr,
      /SNAPBACK_PROOF_GATE_TIMEOUT: gate=hanging timeout_seconds=1 signal=KILL/u,
      'the descendant ignores TERM, so the process group must receive KILL',
    );
    assert.doesNotMatch(run.result.stderr, /SNAPBACK_PROOF_GATE_TIMEOUT_CLEANUP_FAILED/u);
    assert.match(run.records[0].failureSignature, /^sha256:[0-9a-f]{64}$/u);
    const natural124 = fixture(`
proof_gate natural-124 -- /bin/bash -c 'exit 124'
`, { captureSignatures: true });
    try {
      assert.equal(natural124.records[0].terminationReason, 'exit');
      assert.notEqual(
        run.records[0].failureSignature,
        natural124.records[0].failureSignature,
        'the timeout marker/reason must not normalize like a natural exit 124',
      );
    } finally {
      rmSync(natural124.scratch, { recursive: true, force: true });
    }
    child = Number(readFileSync(run.childPid, 'utf8').trim());
    assert(Number.isSafeInteger(child) && child > 1, 'fixture must record its descendant pid');
    assert.equal(processExists(child), false, `descendant ${child} survived the timed-out gate`);
  } finally {
    if (child && processExists(child)) process.kill(child, 'SIGKILL');
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('runtime and static inventory reject every non-canonical timeout spelling', () => {
  const invalid = ['', '00', '010', '08', '1e3', '0x10', '4611686018427387904'];
  for (const value of invalid) {
    const declaration = `run invalid-timeout --timeout-seconds ${JSON.stringify(value)} -- /usr/bin/true`;
    assert.throws(
      () => parseGateCalls(declaration),
      /timeout must be a canonical positive decimal integer/u,
      `static inventory accepted ${JSON.stringify(value)}`,
    );
    const run = fixture(`
proof_gate invalid-timeout --timeout-seconds ${JSON.stringify(value)} -- /usr/bin/true
`);
    try {
      assert.equal(
        run.result.status,
        2,
        `runtime parser accepted ${JSON.stringify(value)}\n${run.result.stdout}\n${run.result.stderr}`,
      );
      assert.equal(run.records.length, 0);
    } finally {
      rmSync(run.scratch, { recursive: true, force: true });
    }
  }
});

test('capture completion is bounded when an escaped writer keeps both FIFOs open', () => {
  const run = fixture(`
proof_gate escaped-writer --timeout-seconds 1 -- /bin/bash -c '
python3 "$FIXTURE_DETACHED_WRITER" &
while [ ! -s "$FIXTURE_WRITER_PID" ]; do sleep 0.01; done
sleep 60
'
`, { captureSignatures: true, termGraceSeconds: 0, captureDrainSeconds: 1 });
  let writer;
  try {
    assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
    assert(run.elapsedMs < 12_000, `capture path remained blocked for ${run.elapsedMs}ms`);
    assert.deepEqual(
      run.records.map(({ state, exitCode, terminationReason }) => (
        [state, exitCode, terminationReason]
      )),
      [['FAIL', 124, 'timeout-cleanup-failed']],
    );
    assert.match(
      run.result.stderr,
      /SNAPBACK_PROOF_GATE_TIMEOUT_CLEANUP_FAILED: gate=escaped-writer capture_stream=/u,
    );
    assert.match(run.records[0].failureSignature, /^sha256:[0-9a-f]{64}$/u);
    writer = Number(readFileSync(run.writerPid, 'utf8').trim());
    assert.equal(processExists(writer), true, 'fixture must genuinely leave its FIFO writer alive');
  } finally {
    if (!writer && existsSync(run.writerPid)) {
      writer = Number(readFileSync(run.writerPid, 'utf8').trim());
    }
    if (writer && processExists(writer)) process.kill(writer, 'SIGKILL');
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('timeout cleanup reaches a genuinely setsid-detached descendant', () => {
  const run = fixture(`
proof_gate session-escape --timeout-seconds 1 -- node "$FIXTURE_SIGNAL_CLEANUP_GATE"
`, { termGraceSeconds: 1 });
  let child;
  try {
    assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
    assert.deepEqual(
      run.records.map(({ state, exitCode, terminationReason }) => (
        [state, exitCode, terminationReason]
      )),
      [['FAIL', 124, 'timeout']],
    );
    child = Number(readFileSync(run.childPid, 'utf8').trim());
    assert(Number.isSafeInteger(child) && child > 1, 'fixture must record its setsid child pid');
    assert.equal(readFileSync(run.marker, 'utf8'), 'signal cleanup ran');
    assert.equal(processExists(child), false, `setsid descendant ${child} survived timeout cleanup`);
  } finally {
    if (!child && existsSync(run.childPid)) {
      child = Number(readFileSync(run.childPid, 'utf8').trim());
    }
    if (child && processExists(child)) process.kill(child, 'SIGKILL');
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('the environment timeout override supersedes a per-gate declaration', () => {
  const run = fixture(`
proof_gate environment-wins --timeout-seconds 30 -- node -e 'setInterval(() => {}, 1000)'
`, { timeoutSeconds: 1, termGraceSeconds: 0 });
  try {
    assert.notEqual(run.result.signal, 'SIGTERM', 'the outer fixture watchdog fired');
    assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
    assert.deepEqual(
      run.records.map(({ gateId, state, exitCode }) => [gateId, state, exitCode]),
      [['environment-wins', 'FAIL', 124]],
    );
    assert.match(
      run.result.stderr,
      /SNAPBACK_PROOF_GATE_TIMEOUT: gate=environment-wins timeout_seconds=1 signal=TERM/u,
    );
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('complete-proof capture emits normalized distinct root-failure signatures', () => {
  const run = fixture(`
proof_gate first -- /bin/bash -c 'printf "failure at /tmp/one\\n  duration_ms: 1.25\\n# duration_ms 12.5\\n" >&2; exit 7'
proof_gate same-normalized -- /bin/bash -c 'printf "failure at /tmp/two\\n  duration_ms: 93.75\\n# duration_ms 99.5\\n" >&2; exit 7'
proof_gate distinct -- /bin/bash -c 'printf "another root cause\\n" >&2; exit 7'
`, { captureSignatures: true });
  try {
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.match(run.records[0].failureSignature, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(run.records[1].failureSignature, run.records[0].failureSignature);
    assert.notEqual(run.records[2].failureSignature, run.records[0].failureSignature);
    assert(run.records.every(({ schemaVersion }) => schemaVersion === 'snapback.proof-gate-result.v3'));
    assert(run.records.every(({ terminationReason }) => terminationReason === 'exit'));
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('keep-going continues independent gates and blocks failed-producer dependents', () => {
  const run = fixture(`
proof_gate native-runtime -- /bin/bash -c 'exit 17'
proof_gate independent-static -- /bin/bash -c 'exit 0'
proof_gate real-server --requires native-runtime -- /bin/bash -c 'touch "$FIXTURE_MARKER"'
`);
  try {
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.equal(existsSync(run.marker), false, 'a blocked command must not execute');
    assert.deepEqual(
      run.records.map(({ gateId, state }) => [gateId, state]),
      [
        ['native-runtime', 'FAIL'],
        ['independent-static', 'PASS'],
        ['real-server', 'BLOCKED'],
      ],
    );
    assert.deepEqual(run.records[2].blockedBy, ['native-runtime']);
    assert.match(run.result.stdout, /1 root failure\(s\), 1 blocked gate\(s\)/);
    assert.match(run.result.stdout, /GATE 1\/3 native-runtime/u);
    assert.match(run.result.stdout, /GATE 2\/3 independent-static/u);
    assert.match(run.result.stdout, /BLOCKED 3\/3 real-server/u);
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('transitive dependency failure blocks without another timeout or product failure', () => {
  const run = fixture(`
proof_gate build -- /bin/bash -c 'exit 9'
proof_gate readiness --requires build -- /bin/bash -c 'touch "$FIXTURE_MARKER"'
proof_gate acceptance --requires readiness -- /bin/bash -c 'touch "$FIXTURE_MARKER"'
`);
  try {
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.equal(existsSync(run.marker), false);
    assert.deepEqual(run.records.map(({ state }) => state), ['FAIL', 'BLOCKED', 'BLOCKED']);
    assert.deepEqual(run.records[2].blockedBy, ['readiness']);
  } finally {
    rmSync(run.scratch, { recursive: true, force: true });
  }
});

test('unknown prerequisites and duplicate gate ids fail closed as inventory errors', () => {
  for (const body of [
    `proof_gate dependent --requires missing -- /usr/bin/true`,
    `proof_gate same -- /usr/bin/true\nproof_gate same -- /usr/bin/true`,
  ]) {
    const run = fixture(body);
    try {
      assert.equal(run.result.status, 2, `${run.result.stdout}\n${run.result.stderr}`);
      assert.match(run.result.stderr, /unknown or not-yet-run prerequisite|duplicate gate id/);
    } finally {
      rmSync(run.scratch, { recursive: true, force: true });
    }
  }
});
