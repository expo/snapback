import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const runner = join(root, 'scripts', 'lib', 'proof-runner.sh');

function fixture(body, {
  keepGoing = 1,
  selectedCount = null,
  captureSignatures = false,
  timeoutSeconds = null,
  termGraceSeconds = null,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-proof-runner-'));
  const receipt = join(scratch, 'results.jsonl');
  const marker = join(scratch, 'dependent-ran');
  const childPid = join(scratch, 'child.pid');
  const script = `
set -euo pipefail
source ${JSON.stringify(runner)}
proof_runner_init fixture ${JSON.stringify(receipt)} ${keepGoing} ${selectedCount ?? body.match(/proof_gate /gu)?.length ?? 0}
${body}
proof_runner_finish
`;
  const result = spawnSync('/bin/bash', ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FIXTURE_MARKER: marker,
      FIXTURE_CHILD_PID: childPid,
      SNAPBACK_PROOF_CAPTURE_FAILURE_SIGNATURES: captureSignatures ? '1' : '0',
      SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS: timeoutSeconds === null ? '' : String(timeoutSeconds),
      SNAPBACK_PROOF_GATE_TERM_GRACE_SECONDS: termGraceSeconds === null
        ? ''
        : String(termGraceSeconds),
    },
    timeout: 15_000,
  });
  const records = existsSync(receipt)
    ? readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  return { scratch, receipt, marker, childPid, result, records };
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

test('fail-fast preserves the root command exit and never reaches later gates', () => {
  const run = fixture(`
proof_gate producer -- /bin/bash -c 'exit 23'
proof_gate never-reached -- /bin/bash -c 'touch "$FIXTURE_MARKER"'
`, { keepGoing: 0 });
  try {
    assert.equal(run.result.status, 23, run.result.stderr);
    assert.equal(existsSync(run.marker), false);
    assert.deepEqual(
      run.records.map(({ gateId, state, exitCode }) => [gateId, state, exitCode]),
      [['producer', 'FAIL', 23]],
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
      run.records.map(({ gateId, state, exitCode }) => [gateId, state, exitCode]),
      [['hanging', 'FAIL', 124]],
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
    child = Number(readFileSync(run.childPid, 'utf8').trim());
    assert(Number.isSafeInteger(child) && child > 1, 'fixture must record its descendant pid');
    assert.equal(processExists(child), false, `descendant ${child} survived the timed-out gate`);
  } finally {
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
    assert(run.records.every(({ schemaVersion }) => schemaVersion === 'snapback.proof-gate-result.v2'));
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
