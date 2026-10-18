// Also run with SNAPBACK4_LANG4_PACKAGE_ROOT pointing at a tarball installation.
// The installed CLI supplies every snippet; no source rewrite or stub is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const installed = process.env.SNAPBACK4_LANG4_PACKAGE_ROOT;
const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, '../../../target/debug/snapback4');
const manifest = installed && JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
const command = installed ? [process.execPath, join(installed, manifest.bin.snapback4)] : [binary];
function cli(args, cwd, expected = 0) {
  const result = spawnSync(command[0], [...command.slice(1), ...args], { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const card = cli(['guide', 'cleanup', '--full']);
const blocks = [...card.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m => m[1]);
assert.equal(blocks.length, 2, 'both complete guide recipes are exercised');

function fixture(t, index) {
  const cwd = mkdtempSync(join(tmpdir(), 'sb4-lang4-guide-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'snapback'));
  writeFileSync(join(cwd, 'snapback/schema.q'), blocks[index] + '\n');
  const check = JSON.parse(cli(['check', '--json'], cwd));
  assert.equal(check.ok, true);
  assert.deepEqual(check.notes, [], 'the recipe runs as written without compiler or readiness advice');
  const reviewed = JSON.parse(cli(['check', '--ack-notes', '--json'], cwd));
  assert.deepEqual(reviewed.notes, [...reviewed.newNotes, ...reviewed.acknowledgedNotes]);
  const review = JSON.parse(readFileSync(join(cwd, 'snapback/check-notes.json'), 'utf8'));
  assert.equal(review.version, 1);
  assert.match(review.sources, /^[a-f0-9]{64}$/);
  return {
    cwd,
    run(name, args = {}, expected = 0, system = false) {
      return JSON.parse(cli(['run', name, JSON.stringify(args), '--json', ...(system ? [] : ['--as', 'user:alice'])], cwd, expected));
    },
  };
}

test('cleanup: mark, resume child cleanup, then remove empty parents', t => {
  const { run } = fixture(t, 0);
  const folder = run('newFolder').result.id;
  for (let i = 0; i < 3; i++) assert.equal(run('addEntry', { folder, body: `entry ${i}` }).state, 'sent');
  assert.equal(run('archiveFolder', { folder }).state, 'sent');
  const refused = run('addEntry', { folder, body: 'late' }, 1);
  assert.equal(refused.why.code, 'ARCHIVED');
  assert.deepEqual(run('activeFolders').data, []);
  assert.equal(run('removeEmptyArchivedFolders', {}, 0, true).rowsWritten, 0, 'occupied restrict parent remains');
  const swept = run('removeArchivedEntries', {}, 0, true);
  assert.equal(swept.state, 'done');
  assert.equal(swept.rowsWritten, 3);
  assert.equal(run('removeArchivedEntries', {}, 0, true).rowsWritten, 0);
  assert.equal(run('removeEmptyArchivedFolders', {}, 0, true).rowsWritten, 1);
  assert.equal(run('removeEmptyArchivedFolders', {}, 0, true).rowsWritten, 0);
});

test('active-reference: refuse retired or absent targets and preserve history', t => {
  const { run, cwd } = fixture(t, 1);
  const asset = run('newAsset').result.id;
  const record = run('recordAsset', { asset, body: 'retained' }).result;
  assert.equal(run('retireAsset', { asset }).state, 'sent');
  assert.equal(run('recordAsset', { asset, body: 'late' }, 1).why.code, 'INACTIVE');
  assert.equal(run('removeAsset', { asset }).state, 'sent');
  assert.equal(run('recordAsset', { asset, body: 'absent' }, 1).why.code, 'NOT_FOUND');
  const history = cli(['data', 'assetHistory', '--json'], cwd);
  assert.ok(history.includes(record.id) && history.includes(asset) && history.includes('retained'), history);
});
