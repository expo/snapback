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
let spawnError = null;
const checks = [];
const cleanup = { attempted: false, clientResourcesReleased: false, devExited: false, temporaryStateRemoved: false, ok: false };
let failure = null;
let client = null;
let detail = null;
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

try {
  await waitForApplicationReady();
  if (spawnError) throw spawnError;
  const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(ready.ready, true);
  pass('managed-lifecycle', { owned: true, applicationReadyObserved: true, waitLevel: 'application', firstQueryRetries: 0 });
  client = new SnapbackClient(ready.serverUrl, { adminToken: readFileSync(ready.adminTokenFile, 'utf8').trim(), rqsStore: null, offlineQueue: false });
  const initial = await client.query(api.projectDirectory, { args: {} });
  assert.ok(initial.rows.length >= 3);
  assert.ok(initial.rows.every((row) => typeof row.teamName === 'string'));
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  loadedIdentity = { appId: artifacts.appId, bundleHash: artifacts.bundleHash };
  pass('artifact-identity', loadedIdentity);
  pass('relational-directory', { rows: initial.rows.length });
  const created = await client.mutate(api.createProject, { args: { teamSlug: 'studio', title: 'Acceptance mosaic', summary: 'Created through generated CRUD.', status: 'active', budget: 19000 } });
  assert.equal(typeof created.result, 'string');
  pass('create-project', { projectId: created.result });
  detail = await client.liveQuery(api.projectDetail, { args: { projectKey: created.result }, connectionId: 'crud-dashboard-detail' });
  await client.mutate(api.updateProject, { args: { projectKey: created.result, teamSlug: 'platform', title: 'Acceptance mosaic revised', summary: 'Updated through generated CRUD.', status: 'done', budget: 21000 } });
  const updated = (await detail.poll()).find((row) => row.status === 'done');
  assert.ok(updated, 'updated project must be visible on the first live-detail poll');
  assert.equal(updated.title, 'Acceptance mosaic revised');
  pass('update-live-detail', { observedBy: api.projectDetail.id });
  await client.mutate(api.deleteProject, { args: { projectKey: created.result } });
  assert.equal((await detail.poll()).length, 0, 'deleted project must be absent on the first live-detail poll');
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
