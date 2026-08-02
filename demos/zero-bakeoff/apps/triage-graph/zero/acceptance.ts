import {resolve} from 'node:path';
import {assert, assertEqual, createArmSuite, eventually, loadAcceptance} from '../../../shared/harness.mjs';
import {mutators} from './mutators.ts';
import {queries} from './queries.ts';
import {startTriageZeroRuntime} from './runtime.ts';

// @ref LLP 0138#the-six-application-contracts — A1 exercises relations,
// composable predicates, stable pagination, live matching, and access denial.
const manifest = await loadAcceptance('triage-graph');
const evidencePath = resolve(import.meta.dirname, '..', 'evidence', 'zero.v1.json');
const suite = createArmSuite({app: 'triage-graph', provider: 'zero', manifest, evidencePath});
let runtime: Awaited<ReturnType<typeof startTriageZeroRuntime>> | undefined;

async function completeView(view: any, timeoutMs = 20_000) {
  const types: string[] = [];
  await new Promise<void>((resolveComplete, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('complete query timeout'), {code: 'ZERO_QUERY_COMPLETE_TIMEOUT'})), timeoutMs);
    let remove = () => {};
    remove = view.addListener((_data: unknown, type: string) => {
      types.push(type);
      if (type === 'complete') {
        clearTimeout(timer);
        remove();
        resolveComplete();
      }
    });
  });
  return types;
}

try {
  runtime = await startTriageZeroRuntime();
  suite.cleanup(() => runtime!.close());
  const alice = runtime.client('alice');
  const bob = runtime.client('bob');
  const mallory = runtime.client('mallory');

  await suite.pass('tg.inbox-membership', async () => {
    const rows = await alice.run(queries.issues.inbox({}), {type: 'complete'});
    assert(rows.length === 50, 'bounded inbox should return 50 rows');
    assert(rows.every((row: any) => Number(row.teamID.slice(5)) < 10 || row.assigneeID === 'alice'), 'inbox leaked an inaccessible and unassigned issue');
    return {rows: rows.length};
  });

  await suite.pass('tg.relationship-composition', async () => {
    const rows = await alice.run(queries.issues.inbox({teamID: 'team-00'}), {type: 'complete'});
    const row: any = rows[0];
    assert(row?.project?.name, 'project relation missing');
    assert(row?.assignee?.name, 'assignee relation missing');
    assert(Array.isArray(row.labels) && row.labels.length === 2, 'label relation missing');
    assert(Number.isInteger(row.commentCount), 'comment count projection missing');
    const detail: any = await alice.run(queries.issues.detail({issueID: row.id}), {type: 'complete'});
    assert(detail && detail.comments.length <= 20 && detail.activities.length <= 20, 'detail bounds missing');
    return {issueID: row.id, labels: row.labels.length, comments: detail.comments.length};
  });

  await suite.pass('tg.composable-filters', async () => {
    const rows = await alice.run(queries.issues.inbox({teamID: 'team-00', status: 'open', priority: 'urgent', labelID: 'label-000'}), {type: 'complete'});
    assert(rows.length > 0, 'composed filter unexpectedly empty');
    assert(rows.every((row: any) => row.teamID === 'team-00' && row.status === 'open' && row.priority === 'urgent' && row.labels.some((label: any) => label.id === 'label-000')), 'composed filter admitted a nonmatch');
    return {rows: rows.length};
  });

  await suite.pass('tg.stable-pagination', async () => {
    const first = await bob.run(queries.issues.inbox({}), {type: 'complete'});
    const boundary: any = first.at(-1);
    const second = await bob.run(queries.issues.inbox({after: boundary.pageKey, afterID: boundary.id}), {type: 'complete'});
    assertEqual(new Set([...first, ...second].map((row: any) => row.id)).size, first.length + second.length, 'untouched row duplicated across keyset pages');
    return {first: first.length, second: second.length};
  });

  const liveQuery = queries.issues.inbox({teamID: 'team-00', status: 'open'});
  const observer = bob.materialize(liveQuery);
  suite.cleanup(() => observer.destroy());
  await completeView(observer);

  await suite.pass('tg.matching-live-update', async () => {
    const target: any = observer.data[0];
    const title = `Live title ${Date.now()}`;
    const settlement = alice.mutate(mutators.issues.patch({issueID: target.id, title, updatedAt: Date.now()}));
    assertEqual((await settlement.server).type, 'success', 'authoritative mutation failed');
    await eventually(() => (observer.data as any[]).some((row) => row.id === target.id && row.title === title), {timeoutMs: 10_000, label: 'matching Zero live update'});
    return {issueID: target.id};
  });

  await suite.pass('tg.nonmatching-stability', async () => {
    const before = (observer.data as any[]).map((row) => row.id).join(',');
    const nonmatching: any[] = await alice.run(queries.issues.inbox({teamID: 'team-00', status: 'blocked'}), {type: 'complete'});
    const settlement = alice.mutate(mutators.issues.patch({issueID: nonmatching[0].id, title: `Invisible ${Date.now()}`, updatedAt: Date.now()}));
    assertEqual((await settlement.server).type, 'success', 'nonmatching mutation failed');
    await Bun.sleep(150);
    assertEqual((observer.data as any[]).map((row) => row.id).join(','), before, 'nonmatching change perturbed visible result');
  });

  await suite.pass('tg.filter-switch-custody', async () => {
    for (let index = 0; index < 10; index += 1) {
      const teamID = `team-${String(index).padStart(2, '0')}`;
      const status = ['open', 'in_progress', 'blocked', 'closed'][index % 4];
      const rows = await alice.run(queries.issues.inbox({teamID, status}), {type: 'complete'});
      assert(rows.every((row: any) => row.teamID === teamID && row.status === status), `predecessor rows leaked into switch ${index}`);
    }
    return {switches: 10};
  });

  await suite.pass('tg.completeness-state', async () => {
    const fresh = runtime!.client('alice');
    const view = fresh.materialize(queries.issues.inbox({teamID: 'team-09', priority: 'low'}));
    const types = await completeView(view);
    view.destroy();
    assert(types.includes('complete'), 'authoritative completeness was not observable');
    assert(types.every((type) => type === 'unknown' || type === 'complete'), 'unexpected result state');
    return {states: types};
  });

  await suite.pass('tg.outsider-denial', async () => {
    const rows = await mallory.run(queries.issues.inbox({}), {type: 'complete'});
    assertEqual(rows.length, 0, 'Mallory received protected issue rows');
    return {rows: 0};
  });
} catch (error: any) {
  for (const id of manifest.checks) {
    try {
      await suite.gap(id, 'Zero runtime was unavailable before the check could execute', {code: error?.code ?? 'ZERO_RUNTIME_UNAVAILABLE', message: String(error?.message ?? error)});
    } catch (duplicate: any) {
      if (!String(duplicate?.message ?? duplicate).includes('ZERO_BAKEOFF_DUPLICATE_CHECK')) throw duplicate;
    }
  }
}

const receipt = await suite.finish({
  target: {providerVersion: '1.8.0', storage: 'PostgreSQL 17 + zero-cache-dev', clientStore: 'memory (headless acceptance)'},
  fixture: manifest.fixture,
  nonclaims: ['No Cloud Zero claim', 'Headless receipt does not prove browser IndexedDB persistence', 'Sequential switch check is not a browser paint measurement'],
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
