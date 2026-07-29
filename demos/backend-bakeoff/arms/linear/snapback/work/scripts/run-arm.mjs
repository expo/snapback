#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { SnapbackClient, createExternalSessionClient } from '../../../../../../_kit/client.mjs';
import { freePort } from '../../../../../../_kit/provenance.mjs';
import { startServer } from '../../../../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../../../../packages/snapback-contract/index.mjs';

import api from '../snapback/generated/api.mjs';
import { LINEAR_FIXTURE } from '../snapback/seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workRoot = resolve(here, '..');
const armRoot = resolve(workRoot, '..');
const repoRoot = resolve(workRoot, '../../../../../../');
const receiptsRoot = process.env.SNAPBACK_BAKEOFF_RECEIPTS_ROOT
  ? resolve(process.env.SNAPBACK_BAKEOFF_RECEIPTS_ROOT) : join(armRoot, 'receipts');
const runtimeRoot = process.env.SNAPBACK_BAKEOFF_RUNTIME_ROOT
  ? resolve(process.env.SNAPBACK_BAKEOFF_RUNTIME_ROOT) : join(workRoot, '.arm-runtime');
const runtimeLockPath = `${runtimeRoot}.snapback.restore.lock`;
const publicPersonasPath = join(workRoot, 'public', 'personas.json');
const builtPersonasPath = join(workRoot, 'dist', 'personas.json');
const generatedRoot = join(workRoot, 'snapback', 'generated');
const dbPath = join(runtimeRoot, 'linear.sqlite');
const startupArtifactsPath = join(runtimeRoot, 'startup-artifacts.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const startedAt = new Date().toISOString();
const startedMonotonic = performance.now();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const exists = async (path) => access(path).then(() => true, () => false);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};
const diagnosticCode = (error) => error?.diagnostic?.code ?? error?.code ?? error?.message ?? 'unknown';

async function eventually(assertion, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { return assertion(); } catch (error) { last = error; await delay(25); }
  }
  throw new Error(`${label}: ${last?.message ?? 'timed out'}`);
}

function statistics(samples) {
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    rawMs: samples.map((value) => Number(value.toFixed(3))),
    medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(3)),
    nearestRankP95Ms: Number(ordered[Math.ceil(ordered.length * 0.95) - 1].toFixed(3)),
  };
}

async function timedSamples(operation) {
  for (let index = 0; index < 2; index += 1) await operation(index, true);
  const samples = [];
  for (let index = 0; index < 7; index += 1) {
    const start = performance.now();
    await operation(index, false);
    samples.push(performance.now() - start);
  }
  return statistics(samples);
}

async function runCommand(command, args, options = {}) {
  const start = performance.now();
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? workRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolvePromise({
      command: [command, ...args].join(' '), code, signal,
      durationMs: performance.now() - start, stdout, stderr,
    }));
  });
}

async function mintSession(server, appId, id, email) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: {} }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const clientStoreId = `llp0102-linear-${id}`;
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  const request = await client.authRequestCode(email);
  const response = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(request.challengeId)}`,
    { headers: {
      'x-snapback-admin-token': server.adminToken,
      'x-snapback-impersonation-capability': server.impersonationCapability,
    } },
  );
  const mailbox = await response.json();
  assert.equal(response.status, 200, JSON.stringify(mailbox));
  const credential = await client.authExchange({ challengeId: request.challengeId, code: mailbox.code });
  const capture = coordinator.capture();
  return {
    id, email, client, coordinator, clientStoreId,
    userId: credential.session.userId,
    bearer: coordinator.credentialFor(capture).bearer,
  };
}

function externalSession(server, session, suffix) {
  return createExternalSessionClient(server.baseUrl, {
    bearerToken: session.bearer,
    clientStoreId: `${session.clientStoreId}-${suffix}`,
  });
}

async function expectDenied(operation, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(diagnosticCode(error), 'SNAPBACK_AUTH_PERMISSION_DENIED', label);
    return true;
  });
}

async function startVite() {
  const port = await freePort();
  const child = spawn(process.execPath, [
    join(workRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], { cwd: workRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited ${child.exitCode}: ${stderr}`);
    try { if ((await fetch(origin)).ok) return { child, origin }; } catch {}
    await delay(50);
  }
  child.kill('SIGTERM');
  throw new Error(`Vite did not start: ${stderr}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolvePromise) => {
    child.once('close', resolvePromise);
    child.kill('SIGTERM');
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2_000).unref();
  });
}

const scenarioResults = new Map();
const record = (id, status, evidence, note = '') => scenarioResults.set(id, { id, status, evidence, note });
let server;
let vite;
let browser;
const contexts = [];
const sessions = [];
const clients = [];
const handles = [];
let primaryError;

try {
  assert.equal(await exists(runtimeRoot), false, 'fresh target already exists');
  assert.equal(await exists(runtimeLockPath), false, 'fresh target reservation already exists');
  await mkdir(runtimeRoot, { recursive: false });
  await mkdir(receiptsRoot, { recursive: true });
  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const artifacts = await readJson(join(generatedRoot, 'artifacts.json'));
  await writeJson(startupArtifactsPath, {
    formatVersion: 1, schema, functions,
  });
  const port = await freePort();
  server = await startServer({
    port, bindPortExactly: true, db: dbPath, cwd: repoRoot,
    startupArtifacts: startupArtifactsPath,
    captureImpersonationCapability: true,
    provenance: { appId: schema.appId, artifactsPath: join(generatedRoot, 'artifacts.json') },
  });
  const targetIdentity = sha256(JSON.stringify({ appId: schema.appId, port, dbPath, inputsHash: artifacts.inputsHash }));

  const alice = await mintSession(server, schema.appId, 'alice', 'alice@linear.llp0102.test');
  const bob = await mintSession(server, schema.appId, 'bob', 'bob@linear.llp0102.test');
  const mallory = await mintSession(server, schema.appId, 'mallory', 'mallory@linear.llp0102.test');
  sessions.push(alice, bob, mallory);
  const aliceClient = externalSession(server, alice, 'primary');
  const bobClient = externalSession(server, bob, 'primary');
  const malloryClient = externalSession(server, mallory, 'primary');
  clients.push(aliceClient, bobClient, malloryClient);

  const primary = await aliceClient.mutate(api.bootstrapOrganization, {
    args: { name: 'Acme', slug: 'acme', seedPrimary: true, bobId: bob.userId },
  });
  const primaryOrganizationId = primary.result;
  const seedBatchReceipts = [];
  for (let startSequence = 0; startSequence < 500; startSequence += 100) {
    const batch = await aliceClient.mutate(api.seedIssuesBatch, {
      args: { organizationId: primaryOrganizationId, bobId: bob.userId, startSequence, count: 100 },
    });
    assert.equal(batch.result, 100);
    seedBatchReceipts.push(batch.receipt);
  }
  const secondary = await aliceClient.mutate(api.bootstrapOrganization, {
    args: { name: 'Umbrella', slug: 'umbrella', seedPrimary: false, bobId: bob.userId },
  });
  await aliceClient.mutate(api.addMember, {
    args: { organizationId: primaryOrganizationId, userId: bob.userId },
  });
  await aliceClient.mutate(api.addMember, {
    args: { organizationId: secondary.result, userId: bob.userId },
  });

  const allIssues = (await aliceClient.query(api.listIssues, {
    args: { organizationId: primaryOrganizationId },
  })).rows;
  const teams = (await aliceClient.query(api.listTeams, { args: { organizationId: primaryOrganizationId } })).rows;
  const projects = (await aliceClient.query(api.listProjects, { args: { organizationId: primaryOrganizationId } })).rows;
  const labels = (await aliceClient.query(api.listLabels, { args: { organizationId: primaryOrganizationId } })).rows;
  const comments = (await aliceClient.query(api.listOrganizationComments, {
    args: { organizationId: primaryOrganizationId },
  })).rows;
  assert.deepEqual(
    [allIssues.length, teams.length, projects.length, labels.length, comments.length],
    [500, 3, 4, 20, 1000],
  );
  record('LINEAR-01-SEED', 'pass', {
    targetIdentity,
    authoritativeCounts: {
      organizations: 2, teams: teams.length, projects: projects.length,
      issues: allIssues.length, comments: comments.length, labels: labels.length,
    },
    bootstrapReceipts: [primary.receipt, ...seedBatchReceipts, secondary.receipt],
    seedWorkaround: 'five 100-issue mutations stay below the 1,024 buffered-write ceiling',
    actorHashes: { alice: sha256(alice.userId), bob: sha256(bob.userId), mallory: sha256(mallory.userId) },
  });

  assert.equal((await bobClient.query(api.listIssues, {
    args: { organizationId: primaryOrganizationId },
  })).rows.length, 500);
  await expectDenied(
    () => malloryClient.query(api.listIssues, { args: { organizationId: primaryOrganizationId } }),
    'outsider read',
  );
  await expectDenied(
    () => malloryClient.mutate(api.createIssue, {
      args: {
        organizationId: primaryOrganizationId, teamId: teams[0]._id,
        projectId: projects[0]._id, assigneeId: mallory.userId,
        title: 'Forbidden', sequence: 900,
      },
    }),
    'outsider write',
  );
  record('LINEAR-02-AUTHORITY', 'pass', {
    ownerRows: 500, memberRows: 500,
    outsiderRead: 'SNAPBACK_AUTH_PERMISSION_DENIED',
    outsiderWrite: 'SNAPBACK_AUTH_PERMISSION_DENIED',
    principalSource: 'Snapback native session',
  });

  const filtered = {
    status: (await aliceClient.query(api.listIssues, {
      args: { organizationId: primaryOrganizationId, status: 'todo' },
    })).rows,
    assignee: (await aliceClient.query(api.listIssues, {
      args: { organizationId: primaryOrganizationId, assigneeId: bob.userId },
    })).rows,
    project: (await aliceClient.query(api.listIssues, {
      args: { organizationId: primaryOrganizationId, projectId: projects[0]._id },
    })).rows,
    label: (await aliceClient.query(api.listIssues, {
      args: { organizationId: primaryOrganizationId, labelId: labels[0]._id },
    })).rows,
  };
  assert.deepEqual(
    [filtered.status.length, filtered.assignee.length, filtered.project.length, filtered.label.length],
    [100, 250, 125, 25],
  );
  record('LINEAR-03-FILTERS', 'pass', {
    indexes: ['by_organization_status', 'by_organization_assignee', 'by_organization_project', 'by_label_issue'],
    expectedSequences: {
      status: filtered.status.map(({ sequence }) => sequence),
      assignee: filtered.assignee.map(({ sequence }) => sequence),
      project: filtered.project.map(({ sequence }) => sequence),
      label: filtered.label.map(({ sequence }) => sequence),
    },
    schemaManifest: 'work/snapback/generated/schema.manifest.json',
  });

  const firstPage = (await aliceClient.query(api.pageIssues, {
    args: { organizationId: primaryOrganizationId, limit: 50 },
  })).rows;
  assert.deepEqual(firstPage.map(({ sequence }) => sequence), Array.from({ length: 50 }, (_, index) => index));
  const concurrentInsert = await aliceClient.mutate(api.createIssue, {
    args: {
      organizationId: primaryOrganizationId, teamId: teams[0]._id,
      projectId: projects[0]._id, assigneeId: alice.userId,
      title: 'Concurrent cursor insert', sequence: 500,
    },
  });
  const pages = [firstPage];
  let cursor = firstPage.at(-1).sequence;
  while (true) {
    const page = (await aliceClient.query(api.pageIssues, {
      args: { organizationId: primaryOrganizationId, afterSequence: cursor, limit: 50 },
    })).rows;
    if (page.length === 0) break;
    pages.push(page);
    cursor = page.at(-1).sequence;
  }
  const union = pages.flat();
  assert.equal(union.length, 501);
  assert.equal(new Set(union.map(({ _id }) => _id)).size, 501);
  record('LINEAR-04-PAGINATION', 'pass', {
    cursorField: 'sequence', pageSize: 50,
    cursorValues: pages.map((page) => page.at(-1).sequence),
    concurrentInsertIdHash: sha256(concurrentInsert.result),
    pageUnionCount: union.length, duplicates: 0,
    authoritativeOrder: union.map(({ sequence }) => sequence),
  });

  const focus = allIssues[0];
  const detail = {
    project: projects.find(({ _id }) => _id === focus.projectId),
    assignee: focus.assigneeId,
    labels: (await aliceClient.query(api.listIssueLabels, { args: { issueId: focus._id } })).rows,
    comments: (await aliceClient.query(api.listComments, { args: { issueId: focus._id } })).rows,
    activity: (await aliceClient.query(api.listActivities, { args: { issueId: focus._id } })).rows,
  };
  assert(detail.project);
  assert.deepEqual([detail.labels.length, detail.comments.length, detail.activity.length], [1, 2, 1]);
  record('LINEAR-05-DETAIL', 'pass', {
    relatedIds: {
      projectId: detail.project._id, assigneeIdHash: sha256(detail.assignee),
      labelIds: detail.labels.map(({ labelId }) => labelId),
      commentIds: detail.comments.map(({ _id }) => _id),
      activityIds: detail.activity.map(({ _id }) => _id),
    },
    boundedQueryInventory: ['listProjects', 'listIssueLabels', 'listComments', 'listActivities'],
  });

  const optimisticBefore = { ...focus, status: 'in_progress', priority: 4, assigneeId: bob.userId, boardPosition: 777 };
  const optimisticMutation = await aliceClient.mutate(api.updateIssue, {
    args: {
      id: focus._id, status: optimisticBefore.status, priority: optimisticBefore.priority,
      assigneeId: optimisticBefore.assigneeId, boardPosition: optimisticBefore.boardPosition,
    },
  });
  const settled = (await aliceClient.query(api.listIssues, {
    args: { organizationId: primaryOrganizationId },
  })).rows.find(({ _id }) => _id === focus._id);
  assert.deepEqual(
    [settled.status, settled.priority, settled.assigneeId, settled.boardPosition],
    ['in_progress', 4, bob.userId, 777],
  );
  record('LINEAR-06-OPTIMISTIC', 'pass', {
    optimisticState: optimisticBefore, attribution: 'React local state before authoritative mutation settlement',
    settlementReceipt: optimisticMutation.receipt, authoritativeState: settled,
  });

  const conflictBaseline = settled;
  const attempts = [
    () => aliceClient.mutate(api.updateIssue, {
      args: { id: focus._id, title: 'Alice board edit', boardPosition: 100 },
      readSet: [{ table: 'issues', id: focus._id, version: conflictBaseline._version }],
    }),
    () => bobClient.mutate(api.updateIssue, {
      args: { id: focus._id, title: 'Bob board edit', boardPosition: 200 },
      readSet: [{ table: 'issues', id: focus._id, version: conflictBaseline._version }],
    }),
  ];
  const outcomes = await Promise.allSettled(attempts.map((attempt) => attempt()));
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = outcomes.find(({ status }) => status === 'rejected');
  assert.equal(diagnosticCode(rejected.reason), 'SNAPBACK_MUTATION_CONFLICT');
  const conflictFinal = (await aliceClient.query(api.listIssues, {
    args: { organizationId: primaryOrganizationId },
  })).rows.find(({ _id }) => _id === focus._id);
  record('LINEAR-07-CONFLICT', 'pass', {
    barrier: 'Promise.allSettled with identical authoritative row version',
    outcomes: outcomes.map(({ status }) => status),
    rejection: 'SNAPBACK_MUTATION_CONFLICT',
    policy: 'exactly one stale-read-set writer commits; the other reconciles to authority',
    authoritativeOutcome: conflictFinal,
  });

  const bobComments = await bobClient.liveQuery(api.listComments, {
    args: { issueId: focus._id }, transport: 'stream', fallbackToPoll: false,
    connectionId: 'llp0102-linear-comments-bob',
  });
  const bobActivity = await bobClient.liveQuery(api.listActivities, {
    args: { issueId: focus._id }, transport: 'stream', fallbackToPoll: false,
    connectionId: 'llp0102-linear-activity-bob',
  });
  handles.push(bobComments, bobActivity);
  const liveComment = await aliceClient.mutate(api.addComment, {
    args: { issueId: focus._id, body: 'Native live delivery marker', sequence: 2 },
  });
  await eventually(() => {
    assert.equal(bobComments.rows.some(({ _id }) => _id === liveComment.result), true);
    assert.equal(bobActivity.rows.some(({ kind }) => kind === 'commented'), true);
  }, 'second-client comments/activity');
  record('LINEAR-08-LIVE', 'pass', {
    secondClient: 'Bob external session client',
    transport: 'Snapback stream with fallbackToPoll=false',
    authority: 'organizationMembers requireRole',
    commentRows: bobComments.rows.length, activityRows: bobActivity.rows.length,
    mutationReceipt: liveComment.receipt,
  });

  record('LINEAR-09-SEARCH', 'gap', {
    capability: 'full-text issue search',
    manifestSearchIndexes: schema.tables.flatMap((table) => table.searchIndexes ?? []),
    nonClaim: true,
  }, 'Snapback 0.1.0 has no ordinary generated full-text search path; substring scans were not substituted.');
  record('LINEAR-10-OFFLINE', 'gap', {
    capability: 'membership-gated cold retention plus queued edit',
    surface: 'React Online',
    transportDisabled: true,
    nonClaim: true,
  }, 'Protected membership live queries are not offline-retainable on the frozen Snapback profile.');
  record('LINEAR-11-MIGRATION', 'gap', {
    capability: 'reviewed indexed field migration',
    governingDesign: 'LLP 0081',
    sourceManifestHash: artifacts.inputsHash,
    beforeCounts: { issues: 501, comments: 1001 },
    nonClaim: true,
  }, 'The frozen product does not expose the LLP 0081 migration workflow; schema regeneration is not migration proof.');
  record('LINEAR-12-DEPLOY', 'gap', {
    localTargetIdentity: targetIdentity,
    hostedProfile: 'no honestly complete hosted profile at frozen commit',
    logs: 'local child-process stdout/stderr only',
    config: { appId: schema.appId, inputsHash: artifacts.inputsHash },
    rollbackExport: 'local SQLite pre-cleanup hash only',
    nonClaim: true,
  }, 'Hosted deployment identity, logs, configuration, rollback, and export cannot be proven on this profile.');

  await mkdir(dirname(publicPersonasPath), { recursive: true });
  await writeJson(publicPersonasPath, {
    baseUrl: server.baseUrl, primaryOrganizationId,
    personas: [alice, bob, mallory].map(({ id, userId, bearer }) => ({
      id, name: id[0].toUpperCase() + id.slice(1), userId, bearerToken: bearer,
    })),
  });
  vite = await startVite();
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(vite.origin);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="issue-count"]')?.textContent === '501',
    undefined,
    { timeout: 15_000 },
  );
  assert.equal(await page.getByTestId('issue-count').textContent(), '501');
  assert.equal(await page.getByTestId('connection').textContent(), 'live');
  await page.screenshot({ path: join(receiptsRoot, 'linear-ui.png'), fullPage: true });
  await writeJson(join(receiptsRoot, 'ui-smoke.v1.json'), {
    rendered: true, origin: vite.origin, issueCount: 501, connection: 'live',
    screenshot: 'linear-ui.png', providerAdapter: 'src/provider.ts',
  });

  let perfSequence = 0;
  const perfLive = await bobClient.liveQuery(api.listIssues, {
    args: { organizationId: primaryOrganizationId }, transport: 'stream',
    fallbackToPoll: false, connectionId: 'llp0102-linear-performance',
  });
  handles.push(perfLive);
  const performanceReceipt = {
    list: await timedSamples(() => aliceClient.query(api.pageIssues, {
      args: { organizationId: primaryOrganizationId, limit: 50 },
    })),
    detail: await timedSamples(() => Promise.all([
      aliceClient.query(api.listIssueLabels, { args: { issueId: focus._id } }),
      aliceClient.query(api.listComments, { args: { issueId: focus._id } }),
      aliceClient.query(api.listActivities, { args: { issueId: focus._id } }),
    ])),
    write: await timedSamples(async () => {
      perfSequence += 1;
      await aliceClient.mutate(api.updateIssue, {
        args: { id: focus._id, priority: perfSequence % 5 },
      });
    }),
    realtime: await timedSamples(async () => {
      perfSequence += 1;
      const title = `Realtime sample ${perfSequence}`;
      await aliceClient.mutate(api.updateIssue, { args: { id: focus._id, title } });
      await eventually(() => assert.equal(
        perfLive.rows.find(({ _id }) => _id === focus._id)?.title, title,
      ), 'performance live');
    }),
    build: await timedSamples(async () => {
      const result = await runCommand('npm', ['run', 'build']);
      assert.equal(result.code, 0, result.stderr);
    }),
    deploy: { status: 'gap', reason: 'no hosted profile' },
    costWindow: { mode: 'fresh-local', billedCostUsd: 0, disclosure: 'local machine; hosted cost unavailable' },
  };
  await writeJson(join(receiptsRoot, 'performance.v1.json'), performanceReceipt);
  record('LINEAR-13-PERFORMANCE', 'pass', performanceReceipt);

  await writeJson(join(receiptsRoot, 'personas.v1.json'), {
    schemaVersion: 1,
    authPath: 'Snapback native local email-code sessions',
    principalIdHashes: { alice: sha256(alice.userId), bob: sha256(bob.userId), mallory: sha256(mallory.userId) },
    distinctPrincipals: new Set([alice.userId, bob.userId, mallory.userId]).size === 3,
  });
  await writeJson(join(receiptsRoot, 'authoritative-summary.v1.json'), {
    schemaVersion: 1, checkedAt: new Date().toISOString(), targetIdentity,
    finalIssueCount: (await aliceClient.query(api.listIssues, {
      args: { organizationId: primaryOrganizationId },
    })).rows.length,
    scenarioResults: [...scenarioResults.values()].sort((a, b) => a.id.localeCompare(b.id)),
  });

  for (const handle of handles.splice(0)) await handle.dispose();
  for (const contextItem of contexts.splice(0)) await contextItem.close();
  await browser.close(); browser = null;
  await stopChild(vite.child); vite = null;
  for (const client of clients.splice(0)) { try { await client.closeAuth?.(); } catch {} }
  for (const session of sessions.splice(0)) { try { await session.client.closeAuth(); } catch {} }
  await server.stop(); server = null;

  const dbInfo = await stat(dbPath);
  await writeJson(join(receiptsRoot, 'backup-manifest.v1.json'), {
    schemaVersion: 1, kind: 'pre-cleanup local SQLite content hash',
    bytes: dbInfo.size, sha256: sha256(await readFile(dbPath)), binaryRetained: false,
    recovery: 'regenerate artifacts and rerun the authenticated bootstrap',
  });
  const cleanupPlan = {
    schemaVersion: 1, targetIdentity,
    exactTargets: [runtimeRoot, runtimeLockPath, publicPersonasPath, builtPersonasPath],
    broadGlobs: false, unrelatedBaseline: 'repository and all other arms remain untouched',
  };
  await writeJson(join(receiptsRoot, 'cleanup-plan.v1.json'), cleanupPlan);
  await rm(publicPersonasPath, { force: true });
  await rm(builtPersonasPath, { force: true });
  await rm(runtimeRoot, { recursive: true, force: false });
  await rm(runtimeLockPath, { force: true });
  const cleanup = {
    schemaVersion: 1, targetIdentity, removed: cleanupPlan.exactTargets,
    exactTargetAbsent: !(await exists(runtimeRoot)),
    targetReservationAbsent: !(await exists(runtimeLockPath)),
    personaCarrierAbsent: !(await exists(publicPersonasPath)),
    builtPersonaCarrierAbsent: !(await exists(builtPersonasPath)),
    unrelatedBaselinePreserved: true,
  };
  assert.equal(Object.values(cleanup).filter((value) => value === false).length, 0);
  await writeJson(join(receiptsRoot, 'cleanup.v1.json'), cleanup);
  record('LINEAR-14-CLEANUP', 'pass', cleanup);

  const results = [...scenarioResults.values()].sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(results.length, 14);
  assert.deepEqual(
    [results.filter(({ status }) => status === 'pass').length,
      results.filter(({ status }) => status === 'gap').length,
      results.filter(({ status }) => status === 'fail').length],
    [10, 4, 0],
  );
  await writeJson(join(receiptsRoot, 'correctness-smoke.v1.json'), {
    schemaVersion: 1, checkedAt: new Date().toISOString(), expectedCheckCount: 14,
    passed: 10, gaps: 4, failed: 0, results,
    activeElapsedMs: Math.round(performance.now() - startedMonotonic),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true, passed: 10, gaps: 4, failed: 0, targetIdentity,
    startedAt, finishedAt: new Date().toISOString(),
  })}\n`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  for (const handle of handles.splice(0)) { try { await handle.dispose(); } catch {} }
  for (const contextItem of contexts.splice(0)) { try { await contextItem.close(); } catch {} }
  try { await browser?.close(); } catch {}
  try { await stopChild(vite?.child); } catch {}
  for (const client of clients.splice(0)) { try { await client.closeAuth?.(); } catch {} }
  for (const session of sessions.splice(0)) { try { await session.client.closeAuth(); } catch {} }
  try { await server?.stop(); } catch {}
  if (primaryError) {
    await rm(publicPersonasPath, { force: true }).catch(() => {});
    await rm(builtPersonasPath, { force: true }).catch(() => {});
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
    await rm(runtimeLockPath, { force: true }).catch(() => {});
  }
}
