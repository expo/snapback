import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';
import api from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

const EXPECTED_CHECKS = ['managed-lifecycle', 'artifact-identity', 'relational-directory', 'create-project', 'update-live-detail', 'delete-project'];
const root = resolve(import.meta.dirname);
const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-crud-dashboard-'));
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
let detail = null;
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

try {
  const ready = await until(() => { try { return existsSync(readyFile) ? JSON.parse(readFileSync(readyFile, 'utf8')) : null; } catch { return null; } }, 'ready descriptor');
  const loaded = await until(() => events.find((event) => event.state === 'generated-and-loaded' && event.managed === true), 'managed generated-and-loaded lifecycle');
  assert.equal(loaded.serverUrl, ready.serverUrl);
  pass('managed-lifecycle', { owned: true, readyDescriptorObserved: true, generatedAndLoadedObserved: true });
  client = new SnapbackClient(ready.serverUrl, { adminToken: readFileSync(ready.adminTokenFile, 'utf8').trim(), rqsStore: null, offlineQueue: false });
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  loadedIdentity = { appId: artifacts.appId, bundleHash: artifacts.bundleHash };
  pass('artifact-identity', loadedIdentity);
  const initial = await client.query(api.projectDirectory, { args: {} });
  assert.ok(initial.rows.length >= 3);
  assert.ok(initial.rows.every((row) => typeof row.teamName === 'string'));
  pass('relational-directory', { rows: initial.rows.length });
  const created = await client.mutate(api.createProject, { args: { teamSlug: 'studio', title: 'Acceptance mosaic', summary: 'Created through generated CRUD.', status: 'active', budget: 19000 } });
  assert.equal(typeof created.result, 'string');
  pass('create-project', { projectId: created.result });
  detail = await client.liveQuery(api.projectDetail, { args: { projectKey: created.result }, connectionId: 'crud-dashboard-detail' });
  await client.mutate(api.updateProject, { args: { projectKey: created.result, teamSlug: 'platform', title: 'Acceptance mosaic revised', summary: 'Updated through generated CRUD.', status: 'done', budget: 21000 } });
  const updated = await until(async () => (await detail.poll()).find((row) => row.status === 'done'), 'live detail update');
  assert.equal(updated.title, 'Acceptance mosaic revised');
  pass('update-live-detail', { observedBy: api.projectDetail.id });
  await client.mutate(api.deleteProject, { args: { projectKey: created.result } });
  await until(async () => (await detail.poll()).length === 0, 'live detail deletion');
  pass('delete-project', { deleted: true });
} catch (error) {
  failure = { code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_FAILED', message: String(error?.message ?? error).slice(0, 4096) };
} finally {
  cleanup.attempted = true;
  try { detail?.dispose(); if (client) assert.equal((await client.inspect()).subscriptions.length, 0); cleanup.clientResourcesReleased = true; } catch (error) { failure ??= { code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED', message: String(error) }; }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  cleanup.devExited = Boolean(await waitForExit(10000));
  if (!cleanup.devExited) child.kill('SIGKILL');
  try { rmSync(stateRoot, { recursive: true, force: true }); cleanup.temporaryStateRemoved = !existsSync(stateRoot); } catch {}
  cleanup.ok = cleanup.clientResourcesReleased && cleanup.devExited && cleanup.temporaryStateRemoved && failure === null;
}
const passed = failure === null && checks.length === EXPECTED_CHECKS.length && cleanup.ok;
process.stdout.write(`${JSON.stringify({ schemaVersion: 'snapback.starter-acceptance.v1', status: passed ? 'passed' : 'failed', expectedCheckCount: EXPECTED_CHECKS.length, executedCheckCount: checks.length, checks, identity: { artifact: { appId: artifacts.appId, inputsHash: artifacts.inputsHash, schemaHash: artifacts.schemaHash, bundleHash: artifacts.bundleHash }, loaded: loadedIdentity }, lifecycle: checks[0]?.details ?? null, operations: { queryFunctionId: api.projectDirectory.id, mutationFunctionId: api.createProject.id }, cleanup, diagnostic: failure })}\n`);
process.exitCode = passed ? 0 : 1;
