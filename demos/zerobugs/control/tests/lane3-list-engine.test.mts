import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  defaultListContext,
  loadOracleFixture,
  oracleIssueList,
  sourceID,
  sourceUserForPhysical,
  type ListContext,
  type OracleRow,
  type OracleTables,
} from './lane3-oracle.mts';

const CONTROL_ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');
const GENERATED_FUNCTIONS = join(CONTROL_ROOT, 'snapback/generated/functions.manifest.json');
const ALL_TABLES = [
  'user', 'project', 'label', 'issue', 'issueLabel', 'comment', 'emoji',
  'viewState', 'userPref', 'issueNotifications', 'projectUserRead',
  'issueListRead', 'issueLabelRead', 'issueSearchDocument', 'searchEpoch',
] as const;

const FROZEN_QUERY_NAMES = [
  'allLabels', 'allUsers', 'allProjects', 'user', 'crewUser', 'labels',
  'labelsOrderByName', 'issuePreloadV2', 'userPref', 'usersForProject',
  'commentsPage', 'comment', 'issueDetail', 'issueListV2', 'listIssueByID',
  'emojiChange', 'prevNext', 'issueList', 'userPicker',
] as const;

interface ListEnvelope {
  status: 'complete' | 'incomplete' | 'refreshing' | 'not-found-authoritative';
  reason: string | null;
  hasMore: boolean;
  cursor: {id: string; created: number; modified: number} | null;
  examined: number;
  total: number;
  items: Array<{issue: {id: string}}>;
}

async function generatedHandler(name: string): Promise<(
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>> {
  const manifest = JSON.parse(await readFile(GENERATED_FUNCTIONS, 'utf8')) as {
    functions: Array<{
      name: string;
      runtime: {IbexModule: {source: string; export: string}};
    }>;
  };
  const generated = manifest.functions.find(item => item.name === name);
  assert(generated, `generate must emit ${name}`);
  const sandbox: {__snapbackHandlers?: Record<string, unknown>} = {};
  vm.runInNewContext(generated.runtime.IbexModule.source, sandbox, {
    filename: `${name}.generated.mjs`,
  });
  const handler = sandbox.__snapbackHandlers?.[generated.runtime.IbexModule.export];
  assert.equal(typeof handler, 'function');
  return handler as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

async function handlerTables(): Promise<OracleTables> {
  const tables: OracleTables = {};
  for (const table of ALL_TABLES) {
    tables[table] = JSON.parse(
      await readFile(join(FIXTURE_ROOT, `${table}.json`), 'utf8'),
    ) as OracleRow[];
  }
  tables.identityBinding = [];
  return tables;
}

function mockContext(tables: OracleTables, principal: string | null) {
  return {
    auth: principal === null ? null : {userId: principal},
    db: {
      query(table: string) {
        const equals: Array<[string, unknown]> = [];
        let limit = Number.POSITIVE_INFINITY;
        const builder = {
          withIndex() {
            return builder;
          },
          eq(field: string, value: unknown) {
            equals.push([field, value]);
            return builder;
          },
          take(next: number) {
            limit = next;
            return builder;
          },
          async collect() {
            return (tables[table] ?? [])
              .filter(row => equals.every(([field, value]) => row[field] === value))
              .slice(0, limit);
          },
          async first() {
            return (await builder.collect())[0] ?? null;
          },
        };
        return builder;
      },
      async get(table: string, id: string) {
        return (tables[table] ?? []).find(row => row._id === id) ?? null;
      },
    },
  };
}

function installBinding(
  tables: OracleTables,
  principal: string,
  actor: {sourceUserID: string; userID: string},
): void {
  tables.identityBinding.push({
    _id: `identity_${principal}`,
    principal,
    sourceUserID: actor.sourceUserID,
    userID: actor.userID,
  });
}

async function invokeList(
  handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>,
  tables: OracleTables,
  context: ListContext,
  principal: string | null,
  options: {
    limit?: number;
    start?: ListEnvelope['cursor'];
    dir?: 'forward' | 'backward';
  } = {},
): Promise<ListEnvelope> {
  const rows = await handler(mockContext(tables, principal), {
    listContext: context,
    limit: options.limit ?? 1_023,
    start: options.start ?? null,
    dir: options.dir ?? 'forward',
    inclusive: false,
  }) as ListEnvelope[];
  assert.equal(rows.length, 1);
  return rows[0];
}

function ids(envelope: ListEnvelope): string[] {
  return envelope.items.map(item => item.issue.id);
}

test('all 19 frozen query names generate precise result contracts', async () => {
  const manifest = JSON.parse(await readFile(GENERATED_FUNCTIONS, 'utf8')) as {
    functions: Array<{
      kind: string;
      name: string;
      resultContract?: {kind?: string};
    }>;
  };
  for (const name of FROZEN_QUERY_NAMES) {
    const operation = manifest.functions.find(item => item.name === name);
    assert(operation, `${name} is generated`);
    assert.equal(operation.kind, 'LiveQuery', `${name} is group/live eligible`);
    assert.equal(operation.resultContract?.kind, 'records', `${name} result contract`);
  }
});

test('shared list predicate matches an independent raw-source oracle for every filter class', async () => {
  const fixture = await loadOracleFixture();
  const tables = await handlerTables();
  const handler = await generatedHandler('issueListV2');
  installBinding(tables, 'principal_ordinary', fixture.actors['ordinary-user']);
  installBinding(tables, 'principal_crew', fixture.actors['crew-admin']);

  const publicIssue = fixture.tables.issue.find(row => row.visibility === 'public');
  const assignedIssue = fixture.tables.issue.find(row => typeof row.assigneeID === 'string');
  assert(publicIssue && assignedIssue);
  const creator = sourceUserForPhysical(fixture, publicIssue.creatorID);
  const assignee = sourceUserForPhysical(fixture, assignedIssue.assigneeID);
  assert(creator && assignee);

  const labelEdgesByIssue = new Map<string, OracleRow[]>();
  for (const edge of fixture.tables.issueLabel) {
    const current = labelEdgesByIssue.get(String(edge.issueID)) ?? [];
    current.push(edge);
    labelEdgesByIssue.set(String(edge.issueID), current);
  }
  const twoLabelEdges = [...labelEdgesByIssue.values()].find(edges => edges.length >= 2);
  assert(twoLabelEdges);
  const labelNames = twoLabelEdges.slice(0, 2).map(edge => {
    const label = fixture.tables.label.find(row => row._id === edge.labelID);
    assert(label);
    return String(label.name);
  });

  const combinedIssue = fixture.tables.issue.find(issue => (
    issue.visibility === 'public'
    && (labelEdgesByIssue.get(issue._id)?.length ?? 0) > 0
  ));
  assert(combinedIssue);
  const combinedCreator = sourceUserForPhysical(fixture, combinedIssue.creatorID);
  const combinedLabelEdge = labelEdgesByIssue.get(combinedIssue._id)?.[0];
  const combinedLabel = fixture.tables.label.find(row => row._id === combinedLabelEdge?.labelID);
  assert(combinedCreator && combinedLabel);

  const cases: Array<{name: string; context: ListContext; principal?: string | null; actor?: string | null}> = [
    {name: 'open', context: defaultListContext({open: true})},
    {name: 'closed', context: defaultListContext({open: false})},
    {name: 'creator', context: defaultListContext({creator: String(creator.login)})},
    {
      name: 'assignee',
      context: defaultListContext({assignee: String(assignee.login)}),
      principal: 'principal_crew',
      actor: 'crew-admin',
    },
    {name: 'one-label', context: defaultListContext({labels: [labelNames[0]]})},
    {name: 'two-label-intersection', context: defaultListContext({labels: labelNames})},
    {name: 'title-search', context: defaultListContext({textFilter: 'AST `field` should be split'})},
    {name: 'description-search', context: defaultListContext({textFilter: 'All `fields` should be tuples'})},
    {name: 'comment-search', context: defaultListContext({textFilter: 'Valita does not clone'})},
    {name: 'project-restriction', context: defaultListContext({projectName: 'missing-project'})},
    {
      name: 'combined',
      context: defaultListContext({
        open: Boolean(combinedIssue.open),
        creator: String(combinedCreator.login),
        labels: [String(combinedLabel.name)],
        textFilter: String(combinedIssue.title),
      }),
    },
    {name: 'crew-internal', context: defaultListContext(), principal: 'principal_crew', actor: 'crew-admin'},
  ];

  for (const entry of cases) {
    const principal = entry.principal === undefined ? 'principal_ordinary' : entry.principal;
    const actor = entry.actor === undefined ? 'ordinary-user' : entry.actor;
    const actual = await invokeList(handler, tables, entry.context, principal);
    const expected = oracleIssueList(fixture, entry.context, actor).map(sourceID);
    assert.deepEqual(ids(actual), expected, entry.name);
    assert.equal(actual.status, 'complete', `${entry.name} completeness`);
  }

  const ordinary = await invokeList(handler, tables, defaultListContext(), 'principal_ordinary');
  const crew = await invokeList(handler, tables, defaultListContext(), 'principal_crew');
  assert.equal(ordinary.examined, 516, 'ordinary examined count excludes protected roots');
  assert.equal(ordinary.total, 516, 'ordinary total excludes protected roots');
  assert.equal(crew.examined, 517, 'crew examined count includes admitted protected roots');
  assert.equal(crew.total, 517, 'crew total includes admitted protected roots');
});

test('both sort fields and directions walk forward and backward without duplicate or skipped rows', async () => {
  const fixture = await loadOracleFixture();
  const tables = await handlerTables();
  const handler = await generatedHandler('issueListV2');
  installBinding(tables, 'principal_ordinary', fixture.actors['ordinary-user']);

  for (const sortField of ['modified', 'created'] as const) {
    for (const sortDirection of ['asc', 'desc'] as const) {
      const context = defaultListContext({sortField, sortDirection});
      for (const dir of ['forward', 'backward'] as const) {
        const walked: string[] = [];
        let start: ListEnvelope['cursor'] = null;
        for (;;) {
          const page = await invokeList(handler, tables, context, 'principal_ordinary', {
            limit: 37,
            start,
            dir,
          });
          walked.push(...ids(page));
          if (!page.hasMore) {
            assert.equal(page.status, 'complete');
            break;
          }
          assert.equal(page.status, 'incomplete');
          assert.equal(page.reason, 'page-limit');
          assert(page.cursor, 'nonterminal page cursor');
          start = page.cursor;
        }
        const expected = oracleIssueList(fixture, context, 'ordinary-user', dir).map(sourceID);
        assert.deepEqual(walked, expected, `${sortField}/${sortDirection}/${dir}`);
        assert.equal(new Set(walked).size, walked.length, 'walk contains no duplicates');
      }
    }
  }
});

test('deprecated prevNext uses the same ordered-field/id predicate', async () => {
  const fixture = await loadOracleFixture();
  const tables = await handlerTables();
  const handler = await generatedHandler('prevNext');
  installBinding(tables, 'principal_ordinary', fixture.actors['ordinary-user']);
  const context = defaultListContext({sortField: 'created', sortDirection: 'asc'});
  const expected = oracleIssueList(fixture, context, 'ordinary-user');
  const pivotIndex = Math.floor(expected.length / 2);
  const pivot = expected[pivotIndex];
  const cursor = {
    id: String(pivot.id),
    created: Number(pivot.created),
    modified: Number(pivot.modified),
  };
  const nextRows = await handler(mockContext(tables, 'principal_ordinary'), {
    listContext: context,
    issue: cursor,
    dir: 'next',
  }) as ListEnvelope[];
  const prevRows = await handler(mockContext(tables, 'principal_ordinary'), {
    listContext: context,
    issue: cursor,
    dir: 'prev',
  }) as ListEnvelope[];
  assert.deepEqual(ids(nextRows[0]), [sourceID(expected[pivotIndex + 1])]);
  assert.deepEqual(ids(prevRows[0]), [sourceID(expected[pivotIndex - 1])]);
});

test('a small page reports incomplete with an ordered-field/id continuation', async () => {
  const fixture = await loadOracleFixture();
  const tables = await handlerTables();
  const handler = await generatedHandler('issueListV2');
  installBinding(tables, 'principal_ordinary', fixture.actors['ordinary-user']);
  const result = await invokeList(
    handler,
    tables,
    defaultListContext({sortField: 'created', sortDirection: 'asc'}),
    'principal_ordinary',
    {limit: 3},
  );
  assert.equal(result.items.length, 3);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'page-limit');
  assert.equal(result.hasMore, true);
  assert.equal(typeof result.cursor?.id, 'string');
  assert.equal(typeof result.cursor?.created, 'number');
  assert.equal(typeof result.cursor?.modified, 'number');

  const nullLimitRows = await handler(mockContext(tables, 'principal_ordinary'), {
    listContext: defaultListContext(),
    limit: null,
    start: null,
    dir: 'forward',
    inclusive: false,
  }) as ListEnvelope[];
  assert.equal(nullLimitRows[0]?.status, 'incomplete');
  assert.equal(nullLimitRows[0]?.reason, 'positive-limit-required');
  assert.deepEqual(nullLimitRows[0]?.items, []);
  assert.equal(nullLimitRows[0]?.hasMore, true);
});
