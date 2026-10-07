import { once } from 'node:events';
import { inspectSignalTarget, signalRecorded, signalChild, spawnTracked as spawn } from '../../../scripts/test-signals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { processTable, identity, processExists, runProcess, cleanupProcesses } from '../../../scripts/test-processes.mjs';
import { runFile } from '../../../scripts/run-client-tests.mjs';

const fixtures = new URL('./fixtures/process-tables/', import.meta.url);
const table = platform => readFileSync(new URL(`${platform}.txt`, fixtures));
const parse = async (stdout, options = {}) => await processTable({ run: () => ({ status: 0, stdout }), exists: () => true, ...options });
const row = (pid, parent, group, metadata = '501 Sat Oct  3 01:02:03 2026 S /tmp/synthetic helper') => `${pid} ${parent} ${group} ${metadata}\n`;
const exitingLinux = '1301666       0 4294967295 1000 Sun Oct  4 05:45:04 2026 X+ snapback4\n';
const timedOut = () => ({ status: null, error: Object.assign(Error('ps ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  stdout: row(999, 1, 100), stderr: 'incomplete listing' });

test('ps timeout discards partial output and retries once with a larger bounded budget', async () => {
  const budgets = [];
  const rows = await processTable({ run: (command, args, options) => {
    assert.equal(command, 'ps');
    assert.deepEqual(args, ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,stat=,comm=']);
    assert.equal(options.env.LC_ALL, 'C');
    assert.equal(options.maxBuffer, 16 * 1024 * 1024);
    budgets.push(options.timeout);
    return budgets.length === 1 ? timedOut() : { status: 0, stdout: row(100, 1, 100) };
  } });
  assert.deepEqual(budgets, [2000, 60_000]);
  assert.deepEqual(rows.map(r => r.pid), [100]);
});

for (const failure of [timedOut(), { status: 2, stderr: 'ps refused' },
  { status: 0, stdout: '' }, { status: null, error: Object.assign(Error('missing ps'), { code: 'ENOENT' }) }])
test(`ps failure stays closed with bounded calls: ${failure.error?.code ?? `status ${failure.status}`}`, async () => {
  let calls = 0;
  await assert.rejects(async () => await processTable({ run: () => { calls++; return failure; } }), /TEST_PROCESS_INSPECTION/);
  assert.equal(calls, failure.error?.code === 'ETIMEDOUT' ? 2 : 1);
});

test('a nonzero exit after timeout still refuses instead of trusting its stdout', async () => {
  let calls = 0;
  await assert.rejects(async () => await processTable({ run: () => ++calls === 1 ? timedOut()
    : { status: 2, stdout: row(100, 1, 100), stderr: 'retry refused' } }), /TEST_PROCESS_INSPECTION: ps failed: status 2.*retry refused/);
  assert.equal(calls, 2);
});

test('timeout recovery cannot renew the three-fresh-snapshot transient-routing budget', async () => {
  const budgets = [];
  await assert.rejects(async () => await processTable({ platform: 'linux', run: (_command, _args, options) => {
    budgets.push(options.timeout);
    return budgets.length % 2 ? timedOut() : { status: 0, stdout: exitingLinux };
  } }), error => error.message.includes(Buffer.from(exitingLinux.trimEnd()).toString('base64')));
  assert.deepEqual(budgets, [2000, 60_000, 2000, 60_000, 2000, 60_000]);
});

for (const phase of ['before release', 'cleanup verification'])
test(`a ps taking over two seconds recovers and passes the file (${phase})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-slow-ps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'healthy.test.mjs');
  writeFileSync(file, "import test from 'node:test';test('healthy',()=>{});\n");
  let keeper, snapshots = 0;
  const budgets = [], durations = [];
  const result = await runFile(file, { timeout: 3000, onOutput: () => {}, onStart: child => { keeper = child; },
    inspect: async options => {
      snapshots++;
      return await processTable({ ...options, run: async (command, args, options) => {
        if (budgets.length >= 2 || keeper.stdin.writableEnded !== (phase === 'cleanup verification'))
          return await runProcess(command, args, options);
        budgets.push(options.timeout);
        // Exercise Node's real asynchronous timeout, then finish a fresh full ps
        // inside the larger bound, beyond the five-second cleanup deadline.
        // No shell/sleep child can outlive the timeout.
        const started = performance.now();
        const result = await runProcess(process.execPath, ['-e', `setTimeout(() => {
          const r = require('node:child_process').spawnSync(${JSON.stringify(command)}, ${JSON.stringify(args)},
            {timeout:60000,maxBuffer:16*1024*1024});
          if(r.stdout) process.stdout.write(r.stdout);
          if(r.stderr) process.stderr.write(r.stderr);
          process.exitCode = r.status ?? 1;
        }, 3100);`], options);
        durations.push(performance.now() - started);
        return result;
      } });
    },
  });
  assert.deepEqual(budgets, [2000, 60_000]);
  assert.ok(durations[0] >= 2000 && durations[1] >= 3100, JSON.stringify(durations));
  assert.ok(snapshots >= 3, 'pre-release inspection plus two fresh cleanup snapshots');
  assert.equal(result.counts.pass, 1);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.reason, undefined, JSON.stringify(result));
  assert.equal(result.keeperExit.cleanupAcknowledged, true, JSON.stringify(result));
});

test('a late second empty snapshot passes only after both inspections complete', async t => {
  let snapshots = 0, completed = 0;
  const started = performance.now();
  const found = await cleanupProcesses({ pid: process.pid }, { release() {}, inspect: async () => {
    if (++snapshots === 2) await sleep(5100);
    completed++;
    return [];
  } });
  assert.deepEqual(found, []);
  assert.equal(snapshots, 2);
  assert.equal(completed, 2);
  assert.ok(performance.now() - started >= 5100);
  t.diagnostic(`late empty confirmation: ${Math.round(performance.now() - started)} ms`);
});

test('asynchronous commands that never finish time out twice and are reaped', async () => {
  const budgets = [], children = [];
  await assert.rejects(processTable({ run: async (_command, _args, options) => {
    budgets.push(options.timeout);
    // Shorten this transport test's clock only; the recovery tests above use
    // the real two-second timeout. Ignoring SIGTERM must not defeat the bound.
    const result = await runProcess(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000)"],
    { ...options, timeout: 200 });
    children.push(Number(result.stdout.toString().trim()));
    assert.equal(result.error.code, 'ETIMEDOUT');
    assert.equal(result.signal, 'SIGKILL');
    return result;
  } }), /TEST_PROCESS_INSPECTION: ps failed: .*ETIMEDOUT/);
  assert.deepEqual(budgets, [2000, 60_000]);
  for (const pid of children) {
    assert.ok(pid > 0, 'the command ran and wrote partial stdout');
    assert.equal(processExists(pid), false, 'timed-out inspection child was reaped');
  }
});

test('asynchronous command spawn errors, nonzero exits and overflow stay fail-closed', async () => {
  for (const [command, args, diagnostic] of [
    ['/sb4-test-missing-ps', [], /ENOENT/],
    [process.execPath, ['-e', "console.log('partial');process.exit(2)"], /status 2/],
    [process.execPath, ['-e', "process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000)"], /maxBuffer/],
  ]) {
    let calls = 0;
    await assert.rejects(processTable({ run: async (_command, _args, options) => {
      calls++;
      return runProcess(command, args, { ...options, maxBuffer: 128 });
    } }), error => /TEST_PROCESS_INSPECTION/.test(error.message) && diagnostic.test(error.message));
    assert.equal(calls, 1, 'only a timeout authorizes a second command');
  }
});

for (const failure of ['timeout', 'nonzero exit'])
test(`a passing test file fails closed when ps persistently returns ${failure}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-failed-ps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'healthy.test.mjs');
  writeFileSync(file, "import test from 'node:test';test('healthy',()=>{});\n");
  const budgets = [];
  const result = await runFile(file, { onOutput: () => {}, inspect: async options => await processTable({ ...options,
    run: (_command, _args, options) => {
      budgets.push(options.timeout);
      return failure === 'timeout' ? timedOut() : { status: 2, stderr: 'ps refused' };
    },
  }) });
  assert.equal(result.counts.pass, 1);
  assert.equal(result.code, 0);
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'TEST_PROCESS_INSPECTION');
  assert.match(result.inspectionFailure, failure === 'timeout' ? /ETIMEDOUT/ : /status 2.*ps refused/);
  assert.deepEqual(budgets, failure === 'timeout' ? [2000, 60_000, 2000, 60_000] : [2000, 2000]);
  assert.equal(result.keeperExit.cleanupAcknowledged, true, JSON.stringify(result));
});

// The bad snapshot must be discarded, never used as a source of ownership.
// A fresh table, not the apparent PID's existence, decides whether we recover.
for (const phase of ['before release', 'cleanup verification']) for (const present of [false, true])
test(`recorded Linux exiting PGID cannot fail a healthy file (${phase}, exists ${present})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-exiting-pgid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'healthy.test.mjs');
  writeFileSync(file, "import test from 'node:test';test('healthy',()=>{});\n");
  let snapshots = 0, injected = 0, probes = 0, keeper;
  const result = await runFile(file, { onOutput: () => {}, onStart: child => { keeper = child; }, inspect: async options => await processTable({ ...options,
    platform: 'linux', exists: () => { probes++; return present; },
    run: async (...args) => {
      const result = await runProcess(...args);
      snapshots++;
      if (injected < 2 && keeper.stdin.writableEnded === (phase === 'cleanup verification')) {
        injected++;
        result.stdout = Buffer.concat([result.stdout, Buffer.from(exitingLinux)]);
      }
      return result;
    },
  }) });
  assert.equal(injected, 2, 'exercise both retries before the third, fresh snapshot');
  assert.ok(snapshots >= 5, 'fresh enumeration plus two cleanup inspections');
  assert.equal(probes, 0, 'an apparent PID never authorizes ignoring damaged routing');
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.reason, undefined, JSON.stringify(result));
  assert.equal(result.inspectionFailure, undefined, JSON.stringify(result));
  assert.equal(result.keeperExit.cleanupAcknowledged, true, JSON.stringify(result));
});

test('persistent captured routing anomaly fails a healthy file and still releases its keeper', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-persistent-pgid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'healthy.test.mjs');
  writeFileSync(file, "import test from 'node:test';test('healthy',()=>{});\n");
  const result = await runFile(file, { onOutput: () => {}, inspect: async options => await processTable({ ...options,
    platform: 'linux', exists: () => false,
    run: async (...args) => {
      const result = await runProcess(...args);
      result.stdout = Buffer.concat([result.stdout, Buffer.from(exitingLinux)]);
      return result;
    },
  }) });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'TEST_PROCESS_INSPECTION');
  assert.ok(result.inspectionFailure.includes(Buffer.from(exitingLinux.trimEnd()).toString('base64')));
  assert.equal(result.keeperExit.cleanupAcknowledged, true, JSON.stringify(result));
});

const transientRows = [
  ['linux', exitingLinux],
  ['linux', exitingLinux.replace('4294967295', '-1')],
  ['linux', exitingLinux.replace('4294967295', '100')],
  ['linux', exitingLinux.replace('       0 ', '       1 ')],
  ...['-1', '4294967295'].flatMap(group => ['Z', '?', '?E', 'SE+', 'SXE'].map(state =>
    ['darwin', row(101, 1, group, `-2 Sun Oct  4 05:45:04 2026 ${state} (exiting helper)`)])),
];
test('recognized Linux/Darwin exit shapes retry whole tables and classify only the fresh scope', async () => {
  for (const [platform, bad] of transientRows) {
    let calls = 0;
    const rows = await processTable({ platform, group: 100, exists: () => { throw Error('no existence shortcut'); },
      run: () => ({ status: 0, stdout: ++calls === 1 ? bad + row(102, 100, 100) : row(101, 1, 100) }),
    });
    assert.equal(calls, 2, bad);
    assert.deepEqual(rows.map(r => r.pid), [101], 'discarded snapshot contributes no members or ancestry');
  }
});

test('persistent exit-shaped malformed routing fails closed after three snapshots even for an absent PID', async () => {
  for (const [platform, bad] of transientRows) for (const present of [false, true]) {
    let calls = 0;
    await assert.rejects(async () => await processTable({ platform, group: 999, exists: () => present,
      run: () => { calls++; return { status: 0, stdout: bad }; },
    }), error => /TEST_PROCESS_INSPECTION/.test(error.message) && error.message.includes(Buffer.from(bad.trimEnd()).toString('base64')));
    assert.equal(calls, 3, bad);
  }
});

test('damaged prefixes outside the precise exit shapes refuse without retry or an existence shortcut', async () => {
  for (const [platform, bad] of [
    ...['S', '?', 'Z', 'SX', 'XX'].map(state => ['linux', exitingLinux.replace('X+', state)]),
    ...['S', 'SX', 'X'].map(state => ['darwin', row(101, 1, -1, `501 Sun Oct 4 05:45:04 2026 ${state} helper`)]),
    ['linux', exitingLinux.replace('1301666', '2147483648')],
    ['linux', exitingLinux.replace('       0 ', '      -1 ')],
    ['linux', exitingLinux.replace('4294967295', '4294967294')],
    ['linux', exitingLinux.replace('1000 Sun', 'bad Sun')],
    ['linux', exitingLinux.replace('Sun Oct', 'bad Oct')],
    ['freebsd', exitingLinux],
  ]) {
    let calls = 0;
    await assert.rejects(async () => await processTable({ platform, exists: () => false,
      run: () => { calls++; return { status: 0, stdout: bad }; },
    }), /TEST_PROCESS_INSPECTION/);
    assert.equal(calls, 1, bad);
  }
});

test('retry never masks a failed listing or persistent related malformed metadata', async () => {
  for (const next of [{ status: 2, stderr: 'failed reread' }, { status: 0, stdout: '' },
    { status: 0, stdout: row(101, 100, 100, 'bad') }, { status: 0, stdout: '101 bad 100\n' }]) {
    let calls = 0;
    await assert.rejects(async () => await processTable({ platform: 'linux', group: 100, exists: () => true,
      run: () => ++calls === 1 ? { status: 0, stdout: exitingLinux } : next,
    }), /TEST_PROCESS_INSPECTION/);
    assert.equal(calls, 2);
  }
});

test('changing transient PIDs cannot renew the retry budget or replace the first rejected bytes', async () => {
  let calls = 0;
  const started = performance.now();
  await assert.rejects(async () => await processTable({ platform: 'linux', run: () => ({ status: 0,
    stdout: exitingLinux.replace('1301666', String(1301666 + calls++)),
  }) }), error => error.message.includes(Buffer.from(exitingLinux.trimEnd()).toString('base64')));
  assert.equal(calls, 3);
  assert.ok(performance.now() - started >= 100, 'two actual 50 ms snapshot intervals');
});

test('Darwin question-mark, E (exiting) and X (traced) flags with valid routing stay conservatively live', async () => {
  for (const state of ['?', '?E', 'SE+', 'SX', 'SXE']) {
    assert.equal((await parse(row(101, 0, 100, `501 Sun Oct 4 05:45:04 2026 ${state} helper`), { platform: 'darwin' }))[0].alive, true);
  }
});

for (const platform of ['darwin', 'linux']) test(`${platform} recorded synthetic ps table parses every field and state`, async () => {
  const rows = await parse(table(platform));
  assert.equal(rows.length, platform === 'darwin' ? 14 : 10);
  assert.equal(rows.find(r => r.pid === 4100).parent, 1);
  assert.equal(rows.find(r => r.pid === 4100).group, 4100);
  assert.equal(rows.find(r => r.pid === 4100).start, 'Sat Oct 3 01:02:03 2026');
  assert.equal(rows.find(r => r.pid === 4101).start, 'Sat Oct 3 01:02:03 2026');
  assert.deepEqual(rows.filter(r => !r.alive).map(r => r.pid), [platform === 'darwin' ? 4109 : 4105]);
  assert.ok(rows.filter(r => r.alive).every(r => r.start && r.executable));
  if (platform === 'darwin') {
    assert.equal(rows[0].pid, 0); assert.equal(rows[0].group, 0);
    assert.deepEqual(rows[1], { pid: 889, parent: 1, group: 889, uid: -2,
      start: 'Wed Sep 30 06:38:25 2026', alive: true, executable: '/usr/sbin/distnoted' });
    assert.equal(rows.find(r => r.pid === 4101).executable, '/Applications/Synthetic App.app/Contents/MacOS/Synthetic App');
    assert.equal(rows.find(r => r.pid === 4110).uid, -2147483648);
    assert.equal(rows.find(r => r.pid === 4111).uid, -1);
  } else {
    assert.equal(rows.find(r => r.pid === 4101).executable, 'a name ) ( helper');
    assert.equal(rows.find(r => r.pid === 4106).uid, 4294967294);
    assert.equal(rows.find(r => r.pid === 4107).uid, 4294967295);
  }
});

test('unrelated metadata is never validated or probed, and is counted diagnostically', async () => {
  const diagnostics = [];
  const rows = await parse(row(100, 1, 100) + row(200, 1, 200, 'unreadable uid start state comm') + '201 1 201\n', {
    group: 100, exists: () => { throw Error('unrelated row must not be probed'); },
    onDiagnostic: value => diagnostics.push(value),
  });
  assert.deepEqual(rows.map(r => r.pid), [100]);
  assert.deepEqual(diagnostics, [{ unrelatedRows: 2 }]);
});

for (const [relation, pid, parent, group] of [
  ['group member', 101, 1, 100], ['direct descendant outside group', 101, 100, 101],
  ['transitive descendant outside group', 102, 101, 102],
  ['zombie group member', 103, 1, 100],
]) test(`malformed metadata for a ${relation} stays fail-closed`, async () => {
  const bad = row(pid, parent, group, `bad Sat Oct  3 01:02:03 2026 ${relation.startsWith('zombie') ? 'Z' : 'S'} helper`);
  const stdout = bad + row(101, 100, 101) + row(100, 1, 100);
  await assert.rejects(async () => await parse(stdout, { group: 100 }), error => {
    assert.match(error.message, /TEST_PROCESS_INSPECTION/);
    assert.ok(error.message.includes(Buffer.from(bad.trimEnd()).toString('base64')));
    return true;
  });
});

for (const bad of ['bad 1 2', '100 bad 2', '100 1 bad', '-1 1 2', '100 -1 2', '100 1 -2',
  '9007199254740992 1 2', '100 1 2147483648', '100 truncated'])
  test(`unclassifiable routing prefix fails closed: ${bad}`, async () => {
    await assert.rejects(async () => await parse(`${bad}\n`, { group: 999, exists: () => false }), /malformed ps row: pid\/ppid\/pgid/);
  });

test('vanished related metadata remains exited after its routing prefix was classified', async () => {
  assert.deepEqual(await parse(row(101, 100, 100, 'truncated'), { group: 100, exists: () => false }), []);
});

test('Darwin identity lookup validates its own row without unrelated metadata poisoning', async () => {
  const stdout = row(100, 1, 100) + row(200, 1, 200, 'unparseable');
  const inspect = async options => await parse(stdout, options);
  assert.equal((await identity(100, { platform: 'darwin', inspect })).pid, 100);
  assert.equal(await identity(101, { platform: 'darwin', inspect }), undefined);
  await assert.rejects(async () => await identity(200, { platform: 'darwin', inspect }), /TEST_PROCESS_INSPECTION/);
});

test('scoped Darwin identity rereads classify fresh routing before ancillary metadata', async () => {
  const lookup = async stdout => await identity(101, { platform: 'darwin', group: 100, inspect: async options => await parse(stdout, options) });
  for (const metadata of ['unreadable', undefined]) {
    assert.equal(await lookup(row(101, 1, 200, metadata)), undefined, 'reused PID is outside the file scope');
  }
  for (const stdout of [row(101, 1, 100, 'bad'), row(101, 100, 200, 'bad'),
    row(101, 102, 200, 'bad') + row(102, 100, 200), '101 bad 200\n']) {
    await assert.rejects(async () => await lookup(stdout), /TEST_PROCESS_INSPECTION/);
  }
  assert.equal((await lookup(row(101, 100, 200))).pid, 101, 'visible descendant remains inspectable');
});

// Run the actual Darwin JavaScript branch on Linux as well. Only this isolated
// test process's platform and ps snapshots change; the keeper still owns and
// releases its real group. Reuse is represented by two snapshots, not signals.
for (const phase of ['before release', 'cleanup verification']) {
  for (const metadata of ['malformed', 'well-formed']) {
    test(`Darwin ${phase} ignores a reused unrelated PID with ${metadata} metadata`, async t => {
      const dir = mkdtempSync(join(tmpdir(), 'sb4-darwin-reuse-'));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const file = join(dir, 'healthy.test.mjs');
      writeFileSync(file, "import test from 'node:test';test('healthy',()=>{});\n");
      const platform = Object.getOwnPropertyDescriptor(process, 'platform');
      t.after(() => {
        Object.defineProperty(process, 'platform', platform);
      });
      let keeper, injected = false, freshReads = 0;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const run = async (command, args, options) => {
        const result = await runProcess(command, args, options);
        if (command === 'ps' && result.status === 0) {
          result.stdout = Buffer.from(result.stdout.toString().split('\n').map(line => {
            if (Number(/^\s*(\d+)/.exec(line)?.[1]) !== process.pid) return line;
            if (injected) freshReads++;
            return row(process.pid, 1, process.pid, metadata === 'malformed' ? 'unreadable' : undefined).trimEnd();
          }).join('\n'));
        }
        return result;
      };
      const result = await runFile(file, { onOutput: () => {}, onStart: child => { keeper = child; }, inspect: async options => {
        const rows = await processTable({ ...options, run });
        if (!injected && keeper.stdin.writableEnded === (phase === 'cleanup verification')) {
          injected = true;
          rows.push({ pid: process.pid, parent: keeper.pid, group: keeper.pid, alive: true, start: 'old snapshot' });
        }
        return rows;
      } });
      assert.ok(injected, `stale enumeration injected ${phase}`);
      assert.ok(freshReads > 0, 'identity reread received the unrelated replacement');
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(result.reason, undefined, JSON.stringify(result));
      assert.equal(result.inspectionFailure, undefined, JSON.stringify(result));
      assert.equal(result.passed, true, JSON.stringify(result));
      assert.equal(result.keeperExit.cleanupAcknowledged, true, JSON.stringify(result));
    });
  }
}

test('5,000-row tables classify reversed ancestry, reparented members and cycles without omissions', async () => {
  const rows = Array.from({ length: 4997 }, (_, i) => row(i + 1000, i === 0 ? 1 : i + 999, i === 0 ? 1000 : i + 1000));
  rows.push(row(7000, 1, 1000)); // group member whose parent has exited
  rows.push(row(8000, 8001, 8000, 'unrelated metadata'), row(8001, 8000, 8001, 'unrelated metadata'));
  const stdout = rows.reverse().join('');
  let diagnostic;
  const parsed = await parse(stdout, { group: 1000, onDiagnostic: d => { diagnostic = d; } });
  assert.equal(parsed.length, 4998);
  assert.equal(new Set(parsed.map(r => r.pid)).size, 4998);
  assert.ok(parsed.some(r => r.pid === 5996)); assert.ok(parsed.some(r => r.pid === 7000));
  assert.deepEqual(diagnostic, { unrelatedRows: 2 });
  await assert.rejects(async () => await parse(stdout.replace(row(5996, 5995, 5996), row(5996, 5995, 5996, 'bad')), { group: 1000 }), /TEST_PROCESS_INSPECTION/);
  assert.equal((await parse(row(100, 101, 100) + row(101, 100, 101), { group: 100 })).length, 2);
});

test('5,000-row macOS-shaped table accepts signed UIDs, flags and spaced paths', async () => {
  const source = table('darwin').toString().trimEnd().split('\n');
  const stdout = Array.from({ length: 5000 }, (_, i) => source[i % source.length]
    .replace(/^\s*\d+\s+\d+\s+\d+/, `${i + 10000} 1 10000`)).join('\n');
  assert.equal((await parse(stdout, { group: 10000 })).length, 5000);
});

test('owned UID, start and state metadata are checked and exact rejected bytes survive', async () => {
  for (const metadata of ['4294967296 Sat Oct 3 01:02:03 2026 S helper',
    '-2147483649 Sat Oct 3 01:02:03 2026 S helper', '1 bad start S helper',
    '1 Sat Oct 3 01:02:03 2026 !!! helper']) {
    await assert.rejects(async () => await parse(row(100, 1, 100, metadata), { group: 100 }), /malformed ps row/);
  }
  const raw = Buffer.concat([Buffer.from('100 1 100 bad '), Buffer.from([0xff, 0, 13])]);
  await assert.rejects(async () => await parse(raw, { group: 100 }), error => error.message.includes(raw.toString('base64')));
});

test('real runner CLI preserves pass, failure and subsequent execution with PATH ps shims', { timeout: 30000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ps-shim-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shimDir = join(dir, 'bin'); mkdirSync(shimDir);
  const shim = join(shimDir, 'ps');
  const files = ['first', 'failure', 'last'].map(name => join(dir, `${name}.test.mjs`));
  for (const [i, file] of files.entries()) writeFileSync(file,
    `import test from 'node:test';test('${i === 1 ? 'intentional failure' : 'healthy'}',()=>{${i === 1 ? "throw Error('KEPT_FAILURE')" : ''}});`);
  const runner = fileURLToPath(new URL('../../../scripts/run-client-tests.mjs', import.meta.url));
  const env = { ...process.env, SB4_PS_NOBODY_PID: String(process.pid) }; delete env.NODE_TEST_CONTEXT;
  // This test can itself run under a shim. Keep its marker separate from the
  // enclosing verification's marker and prove each nested invocation used ours.
  delete env.SB4_PS_SHIM_HITS;
  const hitsFile = join(dir, 'shim-hits'); writeFileSync(hitsFile, '');
  const hits = () => readFileSync(hitsFile, 'utf8').split('\n').filter(Boolean).length;
  const execute = (paths, shimmed) => {
    const before = hits();
    const result = spawnSync(process.execPath, [runner, '1', 'files', ...paths], {
      env: { ...env, PATH: `${shimmed ? shimDir + ':' : ''}${env.PATH}`,
        ...(shimmed ? { SB4_PS_SHIM_HITS: hitsFile } : {}) }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    if (shimmed) assert.ok(hits() > before, 'this CLI invocation must execute the PATH shim');
    else assert.equal(hits(), before, 'baseline must not execute this test-owned shim');
    assert.doesNotMatch(result.stdout + result.stderr, /TEST_PROCESS_INSPECTION|TEST_FILE_KEEPER_EXIT/);
    return { status: result.status, verdicts: [...result.stdout.matchAll(/^-- client file (ok|FAIL): (.+) \(\d+ ms\)$/gm)].map(m => m.slice(1)),
      counts: result.stdout.match(/^-- client files: .*$/m)?.[0], output: result.stdout + result.stderr };
  };
  const baseline = execute(files, false), passing = execute([files[0]], false);
  assert.equal(baseline.status, 1); assert.equal(passing.status, 0);
  assert.deepEqual(baseline.verdicts, files.map((file, i) => [i === 1 ? 'FAIL' : 'ok', file]));
  for (const mode of ['nobody', 'unrelated malformed metadata']) {
    copyFileSync(new URL('ps-nobody.sh', fixtures), shim); chmodSync(shim, 0o755);
    if (mode !== 'nobody') writeFileSync(shim, readFileSync(shim, 'utf8') + `
/bin/ps -p "$SB4_PS_NOBODY_PID" -o pid=,ppid=,pgid=,uid=,lstart=,stat=,comm= |
  awk '{$4 = "unreadable"; print}'
`);
    for (const [paths, control] of [[files, baseline], [[files[0]], passing]]) {
      const actual = execute(paths, true);
      assert.equal(actual.status, control.status, actual.output);
      assert.deepEqual(actual.verdicts, control.verdicts, actual.output);
      assert.equal(actual.counts, control.counts, actual.output);
      assert.match(actual.output, /-- process inspection: .*"unrelatedRows":[1-9]/);
      if (paths.length > 1) assert.match(actual.output, /KEPT_FAILURE/);
    }
  }
});

// Real owned process, intercepted dispatch: a broken guard cannot signal any
// PID (including 0, a negative group ID, or the simulated replacement).
test('every external test signal rechecks exact command and birth at dispatch', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.exit(0));console.log('ready')"], { stdio: ['pipe','pipe','pipe'] });
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const record = inspectSignalTarget(child.pid, child.spawnargs);
    const originalKill = process.kill, originalChildKill = child.kill, attempted = [], handles = [];
    process.kill = (...args) => { attempted.push(args); return true; };
    child.kill = signal => { handles.push(signal); return true; };
    try {
      for (const pid of [0, -1, undefined, NaN, 1.5, 2147483648]) assert.throws(() => signalRecorded({ ...record, pid }, 'SIGKILL', child.spawnargs), /TEST_SIGNAL_REFUSED/);
      assert.throws(() => signalRecorded({ ...record, start: ['wrong-boot', 'wrong-birth'] }, 'SIGKILL', child.spawnargs), /stale.*birth/);
      assert.throws(() => signalRecorded({ ...record, start: undefined }, 'SIGKILL', child.spawnargs), /recorded birth required/);
      assert.throws(() => signalRecorded(record, 'SIGKILL', [...child.spawnargs, 'wrong-command']), /expected process command/);
      assert.throws(() => signalChild({ pid: child.pid, exitCode: null, signalCode: null, spawnargs: child.spawnargs }, 'SIGKILL'), /no captured child birth/);
      // A successful earlier inspection cannot authorize a later wrong command
      // or birth; the signal API must run the shared check again itself.
      inspectSignalTarget(record.pid, child.spawnargs, record.start);
      assert.throws(() => signalRecorded({ ...record, start: [0, 0] }, 'SIGKILL', child.spawnargs), /stale.*birth/);
      assert.deepEqual(attempted, []);
      signalRecorded(record, 'SIGTERM', child.spawnargs);
      signalChild(child, 'SIGINT');
      assert.deepEqual(attempted, [[child.pid, 'SIGTERM']]);
      assert.deepEqual(handles, ['SIGINT'], 'tracked child dispatch uses the retained handle');
      // A handle can close after metadata inspection. That is a refused fault,
      // not a successful injection and never a reason to fall back to its PID.
      child.kill = () => false;
      assert.throws(() => signalChild(child, 'SIGKILL'), /owned child exited before dispatch/);
      assert.deepEqual(attempted, [[child.pid, 'SIGTERM']]);
    } finally { process.kill = originalKill; child.kill = originalChildKill; }
    child.stdin.end(); await exited;
    const originalKillAfterExit = process.kill, staleAttempts = [];
    process.kill = (...args) => { staleAttempts.push(args); return true; };
    try {
      assert.throws(() => signalRecorded(record, 'SIGKILL', child.spawnargs), /TEST_SIGNAL_REFUSED/);
      assert.throws(() => signalChild(child, 'SIGKILL'), /already exited/);
      assert.deepEqual(staleAttempts, []);
    } finally { process.kill = originalKillAfterExit; }
  } finally { child.stdin.end(); await exited; }
});
