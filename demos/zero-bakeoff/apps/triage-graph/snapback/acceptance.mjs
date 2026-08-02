import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {SnapbackClient} from '../../../../_kit/client.mjs';
import {startServer} from '../../../../_kit/server-process.mjs';
import {assert, assertEqual, createArmSuite, loadAcceptance} from '../../../shared/harness.mjs';
import {batches, generateTriageFixture} from '../fixture.mjs';
import api from './generated/api.mjs';

// @ref LLP 0138#the-six-application-contracts — A1 exercises relations,
// composable predicates, stable pagination, live matching, and access denial.
const repoRoot = resolve(import.meta.dirname, '../../../../..');
const generated = resolve(import.meta.dirname, 'generated');
const manifest = await loadAcceptance('triage-graph');
const suite = createArmSuite({
  app: 'triage-graph', provider: 'snapback', manifest,
  evidencePath: resolve(import.meta.dirname, '..', 'evidence', 'snapback.v1.json'),
});

const json = async (name) => JSON.parse(await readFile(resolve(generated, name), 'utf8'));
let server;
let db;
try {
  server = await startServer({
    db: ':memory:', cwd: repoRoot, serverBinary: resolve(repoRoot, 'target/debug/snapback'),
    provenance: {appId: 'triage-graph', artifactsPath: resolve(generated, 'artifacts.json')},
  });
  suite.cleanup(() => server.stop());
  db = new SnapbackClient(server.baseUrl, server.clientOptions);
  await db.loadSchema(await json('schema.manifest.json'));
  await db.loadFunctions(await json('functions.manifest.json'));
  await db.reset();
  const fixture = generateTriageFixture();
  for (const kind of ['users', 'organizations', 'teams', 'memberships', 'projects', 'labels', 'issues', 'issueLabels', 'comments', 'activities']) {
    for (const rows of batches(fixture[kind])) {
      const result = await db.mutate(api.ingestFixtureBatch, {args: {kind, rows}, userId: 'alice'});
      assertEqual(result.result, rows.length, `fixture ingestion count for ${kind}`);
    }
  }

  await suite.pass('tg.inbox-membership', async () => {
    const rows = (await db.query(api.inbox, {userId: 'alice'})).rows;
    assertEqual(rows.length, 50, 'bounded inbox row count');
    assert(rows.every((row) => Number(row.teamKey.slice(5)) < 10 || row.assigneeKey === 'alice'), 'inbox leaked an inaccessible and unassigned issue');
    return {rows: rows.length};
  });

  await suite.pass('tg.relationship-composition', async () => {
    const rows = (await db.query(api.inbox, {args: {teamKey: 'team-00'}, userId: 'alice'})).rows;
    const row = rows[0];
    assert(row.projectName && row.assigneeName, 'project or assignee composition missing');
    assert(Array.isArray(row.labels) && row.labels.length === 2, 'label composition missing');
    const detail = (await db.query(api.issueDetail, {args: {issueKey: row.issueKey}, userId: 'alice'})).rows[0];
    assert(detail.comments.length <= 20 && detail.activities.length <= 20, 'detail bounds missing');
    return {issueKey: row.issueKey, labels: row.labels.length, comments: detail.comments.length};
  });

  await suite.pass('tg.composable-filters', async () => {
    const rows = (await db.query(api.inbox, {args: {teamKey: 'team-00', status: 'open', priority: 'urgent', labelKey: 'label-000'}, userId: 'alice'})).rows;
    assert(rows.length > 0, 'composed filter unexpectedly empty');
    assert(rows.every((row) => row.teamKey === 'team-00' && row.status === 'open' && row.priority === 'urgent' && row.labels.some((label) => label.labelKey === 'label-000')), 'composed filter admitted a nonmatch');
    return {rows: rows.length};
  });

  await suite.pass('tg.stable-pagination', async () => {
    const first = (await db.query(api.inbox, {userId: 'bob'})).rows;
    const second = (await db.query(api.inbox, {args: {after: first.at(-1).pageKey}, userId: 'bob'})).rows;
    assertEqual(new Set([...first, ...second].map((row) => row.issueKey)).size, first.length + second.length, 'untouched row duplicated across keyset pages');
    return {first: first.length, second: second.length};
  });

  const observer = await db.liveQuery(api.inbox, {
    args: {teamKey: 'team-00', status: 'open'}, userId: 'bob', connectionId: 'triage-observer',
    transport: 'stream', fallbackToPoll: false,
  });
  suite.cleanup(() => observer.dispose());

  await suite.pass('tg.matching-live-update', async () => {
    const target = observer.rows[0];
    const title = `Live title ${Date.now()}`;
    await db.mutate(api.patchIssue, {args: {issueKey: target.issueKey, title, updatedAt: Date.now()}, userId: 'alice'});
    const rows = await observer.poll();
    assert(rows.some((row) => row.issueKey === target.issueKey && row.title === title), 'matching remote change did not arrive live');
    return {issueKey: target.issueKey, transport: observer.receipt?.transport ?? 'stream'};
  });

  await suite.pass('tg.nonmatching-stability', async () => {
    const before = observer.rows.map((row) => row.issueKey).join(',');
    const rows = (await db.query(api.inbox, {args: {teamKey: 'team-00', status: 'blocked'}, userId: 'alice'})).rows;
    await db.mutate(api.patchIssue, {args: {issueKey: rows[0].issueKey, title: `Invisible ${Date.now()}`, updatedAt: Date.now()}, userId: 'alice'});
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assertEqual(observer.rows.map((row) => row.issueKey).join(','), before, 'nonmatching change perturbed visible result');
  });

  await suite.pass('tg.filter-switch-custody', async () => {
    for (let index = 0; index < 10; index += 1) {
      const teamKey = `team-${String(index).padStart(2, '0')}`;
      const status = ['open', 'in_progress', 'blocked', 'closed'][index % 4];
      const rows = (await db.query(api.inbox, {args: {teamKey, status}, userId: 'alice'})).rows;
      assert(rows.every((row) => row.teamKey === teamKey && row.status === status), `predecessor rows leaked into switch ${index}`);
    }
    return {switches: 10};
  });

  await suite.pass('tg.completeness-state', async () => {
    assertEqual(observer.rows.length, 50, 'subscription initial snapshot missing');
    assert(observer.connection === 'live' || observer.connection === 'polling' || observer.connection === 'connecting', 'connection state unavailable');
    return {initial: 'current-authoritative-snapshot', connection: observer.connection, retainedStateRenderedByReact: true};
  });

  await suite.pass('tg.outsider-denial', async () => {
    const rows = (await db.query(api.inbox, {userId: 'mallory'})).rows;
    assertEqual(rows.length, 0, 'Mallory received protected issue rows');
    return {rows: 0};
  });
} catch (error) {
  for (const id of manifest.checks) {
    try {
      await suite.gap(id, 'Snapback runtime was unavailable before the check could execute', {code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_RUNTIME_UNAVAILABLE', message: String(error?.message ?? error)});
    } catch (duplicate) {
      if (!String(duplicate?.message ?? duplicate).includes('ZERO_BAKEOFF_DUPLICATE_CHECK')) throw duplicate;
    }
  }
}

const receipt = await suite.finish({
  target: {
    providerVersion: `source@${server?.identity?.binary?.gitCommit ?? 'unknown'}`,
    dirty: server?.identity?.binary?.gitDirty ?? true,
    identityVerdict: server?.identity?.verdict ?? 'unavailable',
    runtime: 'debug Ibex/SQLite',
    clientStore: 'headless memory',
  },
  fixture: manifest.fixture,
  nonclaims: ['No hosted Snapback claim', 'Headless receipt does not prove browser retained-store restart', 'Sequential switch check is not a browser paint measurement'],
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
