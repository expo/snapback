import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaleActions, expectedEnvelope } from './scale.mjs';
import { ReportReducer } from './reducer.mjs';
import { loadMedia } from './services.mjs';
import { generate, verifyGenerated } from './generate.mjs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sha256, line } from './common.mjs';

test('tiny scale action reducer proves report, audit, legal transitions, and account envelope', async () => {
  const reducer = new ReportReducer(await loadMedia());
  for (const action of scaleActions('tiny')) reducer.apply(action);
  const report = reducer.report();
  assert.deepEqual({ large: report.large, total: report.total }, expectedEnvelope('tiny'));
  assert.equal(report.large.audit, 100);
  assert.equal(report.large.open, 11); assert.equal(report.large.overdue, 5);
  assert.equal(report.large.attachmentBytes, 2007);
  assert.equal(report.organizations['small.00'].members['small.00.user.0'].open, 2);
  assert.equal(report.organizations['small.00'].members['small.00.user.1'].open, 1);
  assert.equal(reducer.accounts.size, 8);
});

test('two independently streamed tiny packs have identical bytes/hashes and independently verify', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workroom-scale-')); t.after(() => rm(directory, { recursive: true }));
  const a = await generate({ profile: 'tiny', directory: join(directory, 'a') });
  const b = await generate({ profile: 'tiny', directory: join(directory, 'b') });
  assert.deepEqual(a, b);
  assert.deepEqual(await readFile(join(directory, 'a/actions.ndjson.gz')), await readFile(join(directory, 'b/actions.ndjson.gz')));
  assert.equal((await verifyGenerated(join(directory, 'a'))).verified, true);
  assert.equal((await verifyGenerated(join(directory, 'b'))).verified, true);
  await assert.rejects(generate({ profile: 'tiny', directory: join(directory, 'a') }), { code: 'EEXIST' });
  const starter = await generate({ profile: 'starter', directory: join(directory, 'starter') });
  assert.ok(starter.milestones.W3 > 0 && starter.milestones.W5 > 0);
  assert.equal((await verifyGenerated(join(directory, 'starter'))).verified, true);
});

test('full envelope arithmetic stays explicit, without generating the full log in unit tests', () => {
  const { large, total } = expectedEnvelope('full');
  assert.deepEqual(large, { organizations: 1, members: 2000, projects: 120, tasks: 100000, comments: 300000,
    attachments: 5000, audit: 50000, archivedTasks: 1000, open: 59000, overdue: 29000, attachmentBytes: 1672500 });
  assert.deepEqual(total, { organizations: 51, members: 2100, projects: 220, tasks: 100200, comments: 300200,
    attachments: 5050, audit: 50100, archivedTasks: 1000, open: 59150, overdue: 29100, attachmentBytes: 1702550 });
});

test('manifest verification rejects tampered milestone/operation counts and media identities for scale and journeys', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workroom-manifest-')); t.after(() => rm(root, { recursive: true }));
  for (const profile of ['tiny', 'conformance']) {
    const directory = join(root, profile), manifest = await generate({ profile, directory });
    for (const [mutate, code] of [
      [m => { m.milestones.W1++; }, 'MANIFEST_MILESTONES_MISMATCH'],
      [m => { delete m.milestones.W5; }, 'MANIFEST_MILESTONES_MISMATCH'],
      [m => { m.operations['account.register']++; }, 'MANIFEST_OPERATIONS_MISMATCH'],
      [m => { m.operations['invented.operation'] = 0; }, 'MANIFEST_OPERATIONS_MISMATCH'],
      [m => { m.media[0].sha256 = '0'.repeat(64); }, 'MANIFEST_MEDIA_MISMATCH'],
      [m => { m.media[0].bytes++; }, 'MANIFEST_MEDIA_MISMATCH'],
      [m => { m.media[0].id = 'invented'; }, 'MANIFEST_MEDIA_MISMATCH'],
      [m => { m.media.pop(); }, 'MANIFEST_MEDIA_MISMATCH'],
      [m => { m.profile = 'constructor'; }, 'UNKNOWN_PROFILE'],
      [m => { m.actions.file = '../actions.ndjson.gz'; }, 'INVALID_MANIFEST'],
      [m => { m.profile = profile === 'tiny' ? 'starter' : 'tiny'; }, 'MANIFEST_REPORT_LAYOUT'],
      [m => { m.profile = profile === 'tiny' ? 'full' : 'starter'; }, 'MANIFEST_PROFILE_MISMATCH'],
      [m => { m.profile = 'starter'; m.report = null; m.envelope = null; }, 'MANIFEST_PROFILE_MISMATCH'],
      [m => { if (m.report) m.report.file = 'another-report.json'; else m.report = { file: 'expected-report.json' }; }, 'MANIFEST_REPORT_LAYOUT']
    ]) {
      const changed = structuredClone(manifest); mutate(changed);
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(changed));
      await assert.rejects(verifyGenerated(directory), { code });
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.equal((await verifyGenerated(directory)).verified, true);
  }
});

test('verification binds profile content even when changed log and report hashes agree', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workroom-envelope-')); t.after(() => rm(directory, { recursive: true }));
  const manifest = await generate({ profile: 'tiny', directory });
  const actions = gunzipSync(await readFile(join(directory, manifest.actions.file))).toString().trim().split('\n').map(JSON.parse);
  const task = actions.find(a => a.op === 'task.create' && a.input.dueOffsetMs > 0);
  task.input.dueOffsetMs *= -1;
  const raw = Buffer.from(actions.map(line).join('')), compressed = gzipSync(raw);
  const reducer = new ReportReducer(await loadMedia());
  for (const action of actions) reducer.apply(action);
  const report = Buffer.from(line(reducer.report()));
  Object.assign(manifest.actions, { bytes: raw.length, sha256: sha256(raw), compressed: { bytes: compressed.length, sha256: sha256(compressed) } });
  manifest.report.sha256 = sha256(report);
  await writeFile(join(directory, manifest.actions.file), compressed);
  await writeFile(join(directory, manifest.report.file), report);
  await writeFile(join(directory, 'manifest.json'), line(manifest));
  await assert.rejects(verifyGenerated(directory), { code: 'PROFILE_CONTENT_MISMATCH' });
});

test('scale cannot bypass report verification by rewriting its keys and hashes as a journey', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workroom-profile-')); t.after(() => rm(directory, { recursive: true }));
  const original = await generate({ profile: 'tiny', directory });
  const actions = gunzipSync(await readFile(join(directory, original.actions.file))).toString().trim().split('\n').map(JSON.parse);
  for (const profile of ['starter', 'conformance']) {
    const manifest = structuredClone(original);
    manifest.profile = profile; manifest.report = null; manifest.envelope = null;
    for (const [index, action] of actions.entries()) action.key = `workroom/v1/${profile}/${String(index + 1).padStart(9, '0')}`;
    const raw = Buffer.from(actions.map(line).join('')), compressed = gzipSync(raw);
    Object.assign(manifest.actions, { bytes: raw.length, sha256: sha256(raw), compressed: { bytes: compressed.length, sha256: sha256(compressed) } });
    await writeFile(join(directory, manifest.actions.file), compressed);
    await writeFile(join(directory, 'manifest.json'), line(manifest));
    await assert.rejects(verifyGenerated(directory), { code: 'PROFILE_CONTENT_MISMATCH' });
  }
});
