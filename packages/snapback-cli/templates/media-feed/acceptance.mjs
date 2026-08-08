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
let remainder = '';
let spawnError = null;
const events = [];
const checks = [];
const cleanup = { attempted: false, clientResourcesReleased: false, devExited: false, temporaryStateRemoved: false, ok: false };
let failure = null;
let client = null;
let feed = null;
let loadedIdentity = null;
const append = (chunk) => { output = `${output}${chunk}`.slice(-65536); };
child.stdout.on('data', (chunk) => {
  append(chunk);
  remainder += chunk.toString('utf8');
  for (;;) {
    const newline = remainder.indexOf('\n');
    if (newline < 0) break;
    const line = remainder.slice(0, newline).trim();
    remainder = remainder.slice(newline + 1);
    try { const event = JSON.parse(line); if (event?.schemaVersion === 'snapback.dev.v1') events.push(event); } catch {}
  }
});
child.stderr.on('data', append);
child.on('error', (error) => { spawnError = error; });
const until = async (predicate, label, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const value = await predicate();
    if (value) return value;
    if (child.exitCode !== null) throw new Error(`${label}: dev exited ${child.exitCode}\n${output}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label}: timed out\n${output}`);
};
const pass = (id, details = null) => { assert.equal(EXPECTED_CHECKS[checks.length], id); checks.push({ id, status: 'passed', details }); };
const waitForExit = async (timeoutMs) => until(() => child.exitCode !== null || child.signalCode !== null, 'dev exit', timeoutMs).catch(() => false);
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
  const ready = await until(() => { try { return existsSync(readyFile) ? JSON.parse(readFileSync(readyFile, 'utf8')) : null; } catch { return null; } }, 'ready descriptor');
  const loaded = await until(() => events.find((event) => event.state === 'generated-and-loaded' && event.managed === true), 'managed generated-and-loaded lifecycle');
  assert.equal(loaded.serverUrl, ready.serverUrl);
  pass('managed-lifecycle', { owned: true, readyDescriptorObserved: true, generatedAndLoadedObserved: true });
  const token = await mintSession(readFileSync(ready.adminTokenFile, 'utf8').trim());
  client = createExternalSessionClient(ready.serverUrl, { bearerToken: token, rqsStore: null, offlineQueue: false });
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  loadedIdentity = { appId: artifacts.appId, bundleHash: artifacts.bundleHash };
  pass('artifact-identity', loadedIdentity);
  const first = await client.query(api.liveFeed, { args: {} });
  assert.equal(first.rows.length, 6);
  const older = await client.query(api.olderFeedPage, { args: { before: first.rows.at(-1).createdAt } });
  assert.equal(older.rows.length, 6);
  assert.equal(new Set([...first.rows, ...older.rows].map((row) => row._id)).size, 12);
  pass('retained-live-feed-pages', { first: first.rows.length, older: older.rows.length });
  feed = await client.liveQuery(api.liveFeed, { args: {}, connectionId: 'media-feed-acceptance' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = createAssetClient(client).start({ upload: api.feedPhotoUpload, file: new Blob([png], { type: 'image/png' }), declaredFilename: 'acceptance.png', declaredContentType: 'image/png' });
  const finished = await upload.done;
  assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostic));
  const created = await client.mutate(api.createEntry, { args: { authorName: 'Acceptance', caption: 'Uploaded through typed custody.', photo: finished.assetId } });
  const observed = await until(async () => (await feed.poll()).find((row) => row._id === created.result), 'uploaded feed entry live observation');
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
  try { feed?.dispose(); if (client) assert.equal((await client.inspect()).subscriptions.length, 0); cleanup.clientResourcesReleased = true; } catch (error) { failure ??= { code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED', message: String(error) }; }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  cleanup.devExited = Boolean(await waitForExit(10000));
  if (!cleanup.devExited) child.kill('SIGKILL');
  try { rmSync(stateRoot, { recursive: true, force: true }); cleanup.temporaryStateRemoved = !existsSync(stateRoot); } catch {}
  cleanup.ok = cleanup.clientResourcesReleased && cleanup.devExited && cleanup.temporaryStateRemoved && failure === null;
}
const passed = failure === null && checks.length === EXPECTED_CHECKS.length && cleanup.ok;
process.stdout.write(`${JSON.stringify({ schemaVersion: 'snapback.starter-acceptance.v1', status: passed ? 'passed' : 'failed', expectedCheckCount: EXPECTED_CHECKS.length, executedCheckCount: checks.length, checks, identity: { artifact: { appId: artifacts.appId, inputsHash: artifacts.inputsHash, schemaHash: artifacts.schemaHash, bundleHash: artifacts.bundleHash }, loaded: loadedIdentity }, lifecycle: checks[0]?.details ?? null, operations: { queryFunctionId: api.liveFeed.id, mutationFunctionId: api.createEntry.id }, cleanup, diagnostic: failure })}\n`);
process.exitCode = passed ? 0 : 1;
