import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processTable, identity } from '../../../scripts/test-processes.mjs';

const fixtures = new URL('./fixtures/process-tables/', import.meta.url);
const table = platform => readFileSync(new URL(`${platform}.txt`, fixtures));
const parse = (stdout, options = {}) => processTable({ run: () => ({ status: 0, stdout }), exists: () => true, ...options });
const row = (pid, parent, group, metadata = '501 Sat Oct  3 01:02:03 2026 S /tmp/synthetic helper') => `${pid} ${parent} ${group} ${metadata}\n`;

for (const platform of ['darwin', 'linux']) test(`${platform} recorded synthetic ps table parses every field and state`, () => {
  const rows = parse(table(platform));
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

test('unrelated metadata is never validated or probed, and is counted diagnostically', () => {
  const diagnostics = [];
  const rows = parse(row(100, 1, 100) + row(200, 1, 200, 'unreadable uid start state comm') + '201 1 201\n', {
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
]) test(`malformed metadata for a ${relation} stays fail-closed`, () => {
  const bad = row(pid, parent, group, `bad Sat Oct  3 01:02:03 2026 ${relation.startsWith('zombie') ? 'Z' : 'S'} helper`);
  const stdout = bad + row(101, 100, 101) + row(100, 1, 100);
  assert.throws(() => parse(stdout, { group: 100 }), error => {
    assert.match(error.message, /TEST_PROCESS_INSPECTION/);
    assert.ok(error.message.includes(Buffer.from(bad.trimEnd()).toString('base64')));
    return true;
  });
});

for (const bad of ['bad 1 2', '100 bad 2', '100 1 bad', '-1 1 2', '100 -1 2', '100 1 -2',
  '9007199254740992 1 2', '100 1 2147483648', '100 truncated'])
  test(`unclassifiable routing prefix fails closed: ${bad}`, () => {
    assert.throws(() => parse(`${bad}\n`, { group: 999, exists: () => false }), /malformed ps row: pid\/ppid\/pgid/);
  });

test('vanished related metadata remains exited after its routing prefix was classified', () => {
  assert.deepEqual(parse(row(101, 100, 100, 'truncated'), { group: 100, exists: () => false }), []);
});

test('Darwin identity lookup validates its own row without unrelated metadata poisoning', () => {
  const stdout = row(100, 1, 100) + row(200, 1, 200, 'unparseable');
  const inspect = options => parse(stdout, options);
  assert.equal(identity(100, { platform: 'darwin', inspect }).pid, 100);
  assert.equal(identity(101, { platform: 'darwin', inspect }), undefined);
  assert.throws(() => identity(200, { platform: 'darwin', inspect }), /TEST_PROCESS_INSPECTION/);
});

test('5,000-row tables classify reversed ancestry, reparented members and cycles without omissions', () => {
  const rows = Array.from({ length: 4997 }, (_, i) => row(i + 1000, i === 0 ? 1 : i + 999, i === 0 ? 1000 : i + 1000));
  rows.push(row(7000, 1, 1000)); // group member whose parent has exited
  rows.push(row(8000, 8001, 8000, 'unrelated metadata'), row(8001, 8000, 8001, 'unrelated metadata'));
  const stdout = rows.reverse().join('');
  let diagnostic;
  const parsed = parse(stdout, { group: 1000, onDiagnostic: d => { diagnostic = d; } });
  assert.equal(parsed.length, 4998);
  assert.equal(new Set(parsed.map(r => r.pid)).size, 4998);
  assert.ok(parsed.some(r => r.pid === 5996)); assert.ok(parsed.some(r => r.pid === 7000));
  assert.deepEqual(diagnostic, { unrelatedRows: 2 });
  assert.throws(() => parse(stdout.replace(row(5996, 5995, 5996), row(5996, 5995, 5996, 'bad')), { group: 1000 }), /TEST_PROCESS_INSPECTION/);
  assert.equal(parse(row(100, 101, 100) + row(101, 100, 101), { group: 100 }).length, 2);
});

test('5,000-row macOS-shaped table accepts signed UIDs, flags and spaced paths', () => {
  const source = table('darwin').toString().trimEnd().split('\n');
  const stdout = Array.from({ length: 5000 }, (_, i) => source[i % source.length]
    .replace(/^\s*\d+\s+\d+\s+\d+/, `${i + 10000} 1 10000`)).join('\n');
  assert.equal(parse(stdout, { group: 10000 }).length, 5000);
});

test('owned UID, start and state metadata are checked and exact rejected bytes survive', () => {
  for (const metadata of ['4294967296 Sat Oct 3 01:02:03 2026 S helper',
    '-2147483649 Sat Oct 3 01:02:03 2026 S helper', '1 bad start S helper',
    '1 Sat Oct 3 01:02:03 2026 !!! helper']) {
    assert.throws(() => parse(row(100, 1, 100, metadata), { group: 100 }), /malformed ps row/);
  }
  const raw = Buffer.concat([Buffer.from('100 1 100 bad '), Buffer.from([0xff, 0, 13])]);
  assert.throws(() => parse(raw, { group: 100 }), error => error.message.includes(raw.toString('base64')));
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
  const execute = (paths, shimmed) => {
    const result = spawnSync(process.execPath, [runner, '1', 'files', ...paths], {
      env: { ...env, PATH: `${shimmed ? shimDir + ':' : ''}${env.PATH}` }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
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
