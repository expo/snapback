import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createExternalSessionClient } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
import api from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

const EXPECTED_CHECKS = ['managed-lifecycle', 'artifact-identity', 'retained-live-feed-pages', 'session-upload-and-attach', 'rendition-delivery'];
const root = resolve(import.meta.dirname);
const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-media-feed-'));
const readyFile = join(stateRoot, 'dev.ready.json');
const executable = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'snapback.cmd' : 'snapback');
const child = spawn(executable, ['dev', 'snapback', '--db', join(stateRoot, 'dev.sqlite3'), '--ready-file', readyFile], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
let spawnError = null;
const checks = [];
const cleanup = { attempted: false, clientResourcesReleased: false, devExited: false, temporaryStateRemoved: false, ok: false };
let failure = null;
let client = null;
let feed = null;
let loadedIdentity = null;
const append = (chunk) => { output = `${output}${chunk}`.slice(-65536); };
child.stdout.on('data', (chunk) => {
  append(chunk);
});
child.stderr.on('data', append);
child.on('error', (error) => { spawnError = error; });
const waitForApplicationReady = async () => {
  // @ref LLP 0224#phases — Phase 1 proof: the harness waits on the application-readiness receipt; the first authority-bearing call runs un-retried.
  const waiter = spawn(executable, ['wait', '--ready-file', readyFile, '--level', 'application', '--timeout-ms', '60000'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let waitStdout = '';
  let waitStderr = '';
  waiter.stdout.on('data', (chunk) => { waitStdout = `${waitStdout}${chunk}`.slice(-65536); });
  waiter.stderr.on('data', (chunk) => { waitStderr = `${waitStderr}${chunk}`.slice(-65536); });
  const exit = await new Promise((resolveExit, reject) => { waiter.once('error', reject); waiter.once('close', (code, signal) => resolveExit({ code, signal })); });
  let envelope = null;
  try { envelope = JSON.parse(waitStdout); } catch {}
  if (exit.code !== 0) {
    throw new Error(`application readiness wait failed (${exit.code ?? exit.signal}): ${JSON.stringify(envelope?.diagnostics ?? waitStdout.trim())}${waitStderr ? `\n${waitStderr}` : ''}`);
  }
  assert.equal(envelope?.ok, true, `application readiness wait returned an invalid envelope: ${waitStdout}`);
};
const pass = (id, details = null) => { assert.equal(EXPECTED_CHECKS[checks.length], id); checks.push({ id, status: 'passed', details }); };
const waitForExit = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  return child.exitCode !== null || child.signalCode !== null;
};
const mintSession = async (adminToken) => {
  const mint = spawn(executable, ['session', 'mint', '--email', 'acceptance@media-feed.test', '--ready-file', readyFile], { cwd: root, env: { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  mint.stdout.on('data', (chunk) => { stdout += chunk; });
  mint.stderr.on('data', (chunk) => { stderr += chunk; });
  const exit = await new Promise((resolveExit, reject) => { mint.once('error', reject); mint.once('close', (code, signal) => resolveExit({ code, signal })); });
  if (exit.code !== 0) throw new Error(`session mint failed (${exit.code ?? exit.signal}): ${stderr}`);
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.tokenType, 'Bearer');
  return envelope.data.token;
};

try {
  await waitForApplicationReady();
  if (spawnError) throw spawnError;
  const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(ready.ready, true);
  pass('managed-lifecycle', { owned: true, applicationReadyObserved: true, waitLevel: 'application', firstQueryRetries: 0 });
  const token = await mintSession(readFileSync(ready.adminTokenFile, 'utf8').trim());
  client = createExternalSessionClient(ready.serverUrl, { bearerToken: token, rqsStore: null, offlineQueue: false });
  const first = await client.query(api.liveFeed, { args: {} });
  assert.equal(first.rows.length, 6);
  assert.deepEqual(first.rows.map((row) => row.pageKey), [...first.rows.map((row) => row.pageKey)].sort().reverse());
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  loadedIdentity = { appId: artifacts.appId, bundleHash: artifacts.bundleHash };
  pass('artifact-identity', loadedIdentity);
  const boundary = first.rows.at(-1).pageKey;
  const older = await client.query(api.olderFeedPage, { args: { before: boundary } });
  assert.equal(older.rows.length, 6);
  assert.deepEqual(older.rows.map((row) => row.pageKey), [...older.rows.map((row) => row.pageKey)].sort().reverse());
  assert.equal(first.rows.at(-1).createdAt, older.rows[0].createdAt, 'equal timestamps straddle the unique page-key boundary');
  assert.equal(new Set([...first.rows, ...older.rows].map((row) => row._id)).size, 12);
  feed = await client.liveQuery(api.liveFeed, { args: {}, connectionId: 'media-feed-acceptance' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = createAssetClient(client).start({ upload: api.feedPhotoUpload, file: new Blob([png], { type: 'image/png' }), declaredFilename: 'acceptance.png', declaredContentType: 'image/png' });
  const finished = await upload.done;
  assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostic));
  const created = await client.mutate(api.createEntry, { args: { authorName: 'Acceptance', caption: 'Uploaded through typed custody.', photo: finished.assetId } });
  const olderAfterInsert = await client.query(api.olderFeedPage, { args: { before: boundary } });
  assert.deepEqual(olderAfterInsert.rows.map((row) => row._id), older.rows.map((row) => row._id), 'a newer concurrent insert does not shift the historical page');
  pass('retained-live-feed-pages', {
    first: first.rows.length,
    older: older.rows.length,
    uniqueBoundary: 'pageKey',
    equalTimestampBoundary: true,
    newerInsertStable: true,
  });
  const observed = (await feed.poll()).find((row) => row._id === created.result);
  assert.ok(observed, 'uploaded feed entry must be visible on the first live-feed poll');
  assert.equal(observed.photo, finished.assetId);
  pass('session-upload-and-attach', { assetId: finished.assetId, entryId: created.result });
  const statuses = {};
  for (const rendition of ['thumb', 'display']) {
    const response = await fetch(`${ready.serverUrl}/assets/public/${encodeURIComponent(finished.assetId)}/${rendition}`);
    statuses[rendition] = response.status;
    assert.equal(response.status, 200, `${rendition} rendition must serve`);
    assert.equal(response.headers.get('content-type'), 'image/png');
  }
  pass('rendition-delivery', statuses);
} catch (error) {
  failure = { code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_FAILED', message: String(error?.message ?? error).slice(0, 4096) };
} finally {
  cleanup.attempted = true;
  try { await feed?.dispose(); if (client) assert.equal((await client.inspect()).subscriptions.length, 0); cleanup.clientResourcesReleased = true; } catch (error) { failure ??= { code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED', message: String(error) }; }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  cleanup.devExited = Boolean(await waitForExit(10000));
  if (!cleanup.devExited) child.kill('SIGKILL');
  try { rmSync(stateRoot, { recursive: true, force: true }); cleanup.temporaryStateRemoved = !existsSync(stateRoot); } catch {}
  cleanup.ok = cleanup.clientResourcesReleased && cleanup.devExited && cleanup.temporaryStateRemoved && failure === null;
}
const passed = failure === null && checks.length === EXPECTED_CHECKS.length && cleanup.ok;
process.stdout.write(`${JSON.stringify({ schemaVersion: 'snapback.starter-acceptance.v1', status: passed ? 'passed' : 'failed', expectedCheckCount: EXPECTED_CHECKS.length, executedCheckCount: checks.length, checks, identity: { artifact: { appId: artifacts.appId, inputsHash: artifacts.inputsHash, schemaHash: artifacts.schemaHash, bundleHash: artifacts.bundleHash }, loaded: loadedIdentity }, lifecycle: checks[0]?.details ?? null, operations: { queryFunctionId: api.liveFeed.id, mutationFunctionId: api.createEntry.id }, cleanup, diagnostic: failure })}\n`);
process.exitCode = passed ? 0 : 1;
