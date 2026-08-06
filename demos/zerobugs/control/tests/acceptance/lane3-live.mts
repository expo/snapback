import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {SnapbackClient} from '@expo/snapback-client';

import {
  ACTOR_IDS,
  bindActorsAgainstReadyFile,
  emitActorBindingReceipt,
  type ActorId,
} from '../../scripts/bind-actors.mts';
import {loadFixtureAgainstReadyFile} from '../../scripts/load-fixture.mts';
import {
  defaultListContext,
  loadOracleFixture,
  oracleIssueList,
  sourceID,
  sourceUserForPhysical,
  type ListContext,
  type OracleFixture,
  type OracleRow,
} from '../lane3-oracle.mts';

const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const EXPECTED_CHECKS = 16;
const INTERNAL_ISSUE_ID = 'zbav1_internal_issue';
const INTERNAL_COMMENT_ID = 'zbav1_internal_comment';
const PREF_KEY = 'zerobugs-acceptance.v1';
const FROZEN_QUERY_NAMES = [
  'allLabels',
  'allUsers',
  'allProjects',
  'user',
  'crewUser',
  'labels',
  'labelsOrderByName',
  'issuePreloadV2',
  'userPref',
  'usersForProject',
  'commentsPage',
  'comment',
  'issueDetail',
  'issueListV2',
  'listIssueByID',
  'emojiChange',
  'prevNext',
  'issueList',
  'userPicker',
] as const;

type FrozenQueryName = (typeof FROZEN_QUERY_NAMES)[number];
type JsonRecord = Record<string, unknown>;
type QueryClient = {
  query: (
    reference: unknown,
    options: {args: unknown},
  ) => Promise<{rows: readonly unknown[]}>;
};
type CheckReceipt = {
  id: string;
  status: 'pass' | 'fail';
  error?: string;
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is an object`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} is an array`);
  return value;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} is a string`);
  return value;
}

function number(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `${label} is a number`);
  return value;
}

function bool(value: unknown, label: string): boolean {
  assert.equal(typeof value, 'boolean', `${label} is a boolean`);
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceRowsByPhysicalID(rows: OracleRow[]): Map<string, OracleRow> {
  return new Map(rows.map(row => [row._id, row]));
}

function sourceProject(fixture: OracleFixture, name = 'Zero'): OracleRow {
  const row = fixture.tables.project.find(project => (
    String(project.lowerCaseName) === name.toLowerCase()
  ));
  assert(row, `source project ${name} exists`);
  return row;
}

function sourceIssue(fixture: OracleFixture, id: string): OracleRow {
  const row = fixture.tables.issue.find(issue => issue.id === id);
  assert(row, `source issue ${id} exists`);
  return row;
}

function resultItems(envelope: JsonRecord): JsonRecord[] {
  return array(envelope.items, 'result.items').map((item, index) => record(item, `item ${index}`));
}

function issueIDs(envelope: JsonRecord): string[] {
  return resultItems(envelope).map((item, index) => (
    text(record(item.issue, `item ${index}.issue`).id, `item ${index}.issue.id`)
  ));
}

function sourceIssueCursor(row: OracleRow): JsonRecord {
  return {
    id: text(row.id, 'source issue id'),
    created: number(row.created, 'source issue created'),
    modified: number(row.modified, 'source issue modified'),
  };
}

function visibleSourceIssues(fixture: OracleFixture, actor: ActorId | null): OracleRow[] {
  const crew = actor !== null && fixture.actors[actor].role === 'crew';
  return fixture.tables.issue.filter(issue => issue.visibility === 'public' || crew);
}

function expectedUsersForProject(
  fixture: OracleFixture,
  filter: null | 'crew' | 'creators' | 'assignees',
): OracleRow[] {
  const project = sourceProject(fixture);
  const userIDs = new Set<string>();
  if (filter === null) {
    for (const user of fixture.tables.user) userIDs.add(user._id);
  } else if (filter === 'crew') {
    for (const user of fixture.tables.user) {
      if (user.role === 'crew' && !String(user.login).startsWith('rocibot')) userIDs.add(user._id);
    }
  } else {
    for (const issue of fixture.tables.issue) {
      if (issue.projectID !== project._id) continue;
      const candidate = filter === 'creators' ? issue.creatorID : issue.assigneeID;
      if (typeof candidate === 'string') userIDs.add(candidate);
    }
  }
  return fixture.tables.user
    .filter(user => userIDs.has(user._id))
    .sort((left, right) => {
      const login = compareText(String(left.login), String(right.login));
      return login || compareText(String(left.id), String(right.id));
    });
}

function expectedLabelsForIssue(fixture: OracleFixture, issue: OracleRow): string[] {
  const labels = sourceRowsByPhysicalID(fixture.tables.label);
  return fixture.tables.issueLabel
    .filter(edge => edge.issueID === issue._id)
    .map(edge => labels.get(String(edge.labelID)))
    .filter((label): label is OracleRow => Boolean(label))
    .sort((left, right) => compareText(String(left.name), String(right.name)) || compareText(sourceID(left), sourceID(right)))
    .map(sourceID);
}

function expectedCommentIDs(fixture: OracleFixture, issue: OracleRow, limit: number): string[] {
  return fixture.tables.comment
    .filter(comment => comment.issueID === issue._id)
    .sort((left, right) => (
      Number(right.created) - Number(left.created)
      || compareText(sourceID(right), sourceID(left))
    ))
    .slice(0, limit)
    .map(sourceID);
}

async function main(): Promise<void> {
  const readyFile = resolve(process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE);
  const fixture = await loadOracleFixture();
  const generatedApiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const {default: generatedApi} = await import(pathToFileURL(generatedApiPath).href) as {
    default: Record<string, unknown>;
  };
  const exercised = new Set<FrozenQueryName>();
  const checks: CheckReceipt[] = [];
  let bound: Awaited<ReturnType<typeof bindActorsAgainstReadyFile>> | null = null;
  let anonymous: SnapbackClient | null = null;

  const check = async (id: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      checks.push({id, status: 'pass'});
    } catch (error) {
      checks.push({
        id,
        status: 'fail',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const queryRow = async (
    client: QueryClient,
    name: FrozenQueryName,
    args: JsonRecord,
  ): Promise<JsonRecord> => {
    exercised.add(name);
    const response = await client.query(generatedApi[name], {args});
    assert.equal(response.rows.length, 1, `${name} returns one typed envelope`);
    return record(response.rows[0], `${name} envelope`);
  };

  try {
    const loaded = await loadFixtureAgainstReadyFile(readyFile);
    bound = await bindActorsAgainstReadyFile(readyFile);
    await emitActorBindingReceipt(bound.receipt);
    const ordinarySession = bound.sessions.get('ordinary-user');
    assert(ordinarySession, 'ordinary actor session exists');
    anonymous = new SnapbackClient(ordinarySession.baseUrl, {
      custody: 'anonymous-public',
      adminToken: null,
      rqsStore: null,
    });
    const ordinary = ordinarySession.client as unknown as QueryClient;
    const actorClient = (actor: ActorId): QueryClient => {
      const session = bound?.sessions.get(actor);
      assert(session, `${actor} actor session exists`);
      return session.client as unknown as QueryClient;
    };
    const anonymousClient = anonymous as unknown as QueryClient;

    await check('fresh-fixture-and-lane2-bindings', async () => {
      assert.equal(loaded.counts.issue, fixture.tables.issue.length);
      assert.equal(loaded.counts.comment, fixture.tables.comment.length);
      assert.equal(Object.keys(bound?.receipt.actors ?? {}).length, ACTOR_IDS.length);
      assert.equal(bound?.receipt.rebindingRefused, true);
    });

    await check('catalog-and-point-query-parity', async () => {
      const labels = await queryRow(anonymousClient, 'allLabels', {limit: 1_023, start: null});
      const expectedLabels = [...fixture.tables.label].sort((left, right) => {
        const leftProject = sourceRowsByPhysicalID(fixture.tables.project).get(String(left.projectID));
        const rightProject = sourceRowsByPhysicalID(fixture.tables.project).get(String(right.projectID));
        const project = compareText(sourceID(leftProject ?? left), sourceID(rightProject ?? right));
        return project || compareText(String(left.name), String(right.name)) || compareText(sourceID(left), sourceID(right));
      });
      assert.deepEqual(resultItems(labels).map(item => text(item.id, 'label id')), expectedLabels.map(sourceID));

      const users = await queryRow(anonymousClient, 'allUsers', {limit: 1_023, start: null});
      const expectedUsers = [...fixture.tables.user].sort((left, right) => (
        compareText(String(left.login), String(right.login)) || compareText(sourceID(left), sourceID(right))
      ));
      assert.deepEqual(resultItems(users).map(item => text(item.id, 'user id')), expectedUsers.map(sourceID));

      const projects = await queryRow(anonymousClient, 'allProjects', {limit: 1_023, start: null});
      const expectedProjects = [...fixture.tables.project].sort((left, right) => (
        compareText(String(left.lowerCaseName), String(right.lowerCaseName)) || compareText(sourceID(left), sourceID(right))
      ));
      assert.deepEqual(resultItems(projects).map(item => text(item.id, 'project id')), expectedProjects.map(sourceID));

      const ordinarySource = sourceUserForPhysical(fixture, fixture.actors['ordinary-user'].userID);
      const crewSource = sourceUserForPhysical(fixture, fixture.actors['crew-admin'].userID);
      assert(ordinarySource && crewSource);
      const user = await queryRow(anonymousClient, 'user', {userID: sourceID(ordinarySource)});
      assert.equal(record(user.value, 'user.value').id, sourceID(ordinarySource));
      const crew = await queryRow(anonymousClient, 'crewUser', {userID: sourceID(crewSource)});
      assert.equal(record(crew.value, 'crewUser.value').id, sourceID(crewSource));
      const notCrew = await queryRow(anonymousClient, 'crewUser', {userID: sourceID(ordinarySource)});
      assert.equal(notCrew.status, 'not-found-authoritative');
    });

    await check('project-label-ordering-parity', async () => {
      const project = sourceProject(fixture);
      const expected = fixture.tables.label
        .filter(label => label.projectID === project._id)
        .sort((left, right) => compareText(String(left.name), String(right.name)) || compareText(sourceID(left), sourceID(right)))
        .map(sourceID);
      const natural = await queryRow(anonymousClient, 'labels', {
        projectName: String(project.name), limit: 1_023, start: null,
      });
      assert.deepEqual(resultItems(natural).map(item => text(item.id, 'label id')), expected);
      const ascending = await queryRow(anonymousClient, 'labelsOrderByName', {
        projectName: String(project.name), orderBy: 'asc', limit: 1_023, start: null,
      });
      const descending = await queryRow(anonymousClient, 'labelsOrderByName', {
        projectName: String(project.name), orderBy: 'desc', limit: 1_023, start: null,
      });
      assert.deepEqual(resultItems(ascending).map(item => text(item.id, 'label id')), expected);
      assert.deepEqual(resultItems(descending).map(item => text(item.id, 'label id')), [...expected].reverse());
    });

    await check('project-users-and-deprecated-picker-parity', async () => {
      for (const filter of [null, 'crew', 'creators', 'assignees'] as const) {
        const envelope = await queryRow(anonymousClient, 'usersForProject', {
          disabled: false,
          login: null,
          projectName: 'Zero',
          filter,
          limit: 1_023,
          start: null,
        });
        assert.deepEqual(
          resultItems(envelope).map(item => text(item.id, 'project user id')),
          expectedUsersForProject(fixture, filter).map(sourceID),
          `usersForProject ${String(filter)}`,
        );
      }
      const creator = expectedUsersForProject(fixture, 'creators')[0];
      assert(creator);
      const disabled = await queryRow(anonymousClient, 'usersForProject', {
        disabled: true,
        login: String(creator.login),
        projectName: 'Zero',
        filter: 'crew',
        limit: 5,
        start: null,
      });
      assert.deepEqual(resultItems(disabled).map(item => item.id), [sourceID(creator)]);
      const disabledWithoutLogin = await queryRow(anonymousClient, 'usersForProject', {
        disabled: true,
        login: null,
        projectName: 'Zero',
        filter: null,
        limit: 1_023,
        start: null,
      });
      assert.deepEqual(
        resultItems(disabledWithoutLogin).map(item => item.id),
        expectedUsersForProject(fixture, null).map(sourceID),
      );

      for (const filter of [null, 'crew', 'creators'] as const) {
        const picker = await queryRow(anonymousClient, 'userPicker', {
          disabled: false, login: null, filter, limit: 1_023, start: null,
        });
        assert.deepEqual(
          resultItems(picker).map(item => text(item.id, 'picker user id')),
          expectedUsersForProject(fixture, filter).map(sourceID),
          `userPicker ${String(filter)}`,
        );
      }
      const disabledPicker = await queryRow(anonymousClient, 'userPicker', {
        disabled: true,
        login: String(creator.login),
        filter: 'crew',
        limit: 5,
        start: null,
      });
      assert.deepEqual(resultItems(disabledPicker).map(item => item.id), [sourceID(creator)]);
    });

    await check('list-every-filter-and-combined-parity', async () => {
      const publicIssue = fixture.tables.issue.find(issue => issue.visibility === 'public');
      const internalIssue = sourceIssue(fixture, INTERNAL_ISSUE_ID);
      assert(publicIssue && typeof internalIssue.assigneeID === 'string');
      const creator = sourceUserForPhysical(fixture, publicIssue.creatorID);
      const assignee = sourceUserForPhysical(fixture, internalIssue.assigneeID);
      assert(creator && assignee);
      const edgesByIssue = new Map<string, OracleRow[]>();
      for (const edge of fixture.tables.issueLabel) {
        const current = edgesByIssue.get(String(edge.issueID)) ?? [];
        current.push(edge);
        edgesByIssue.set(String(edge.issueID), current);
      }
      const twoEdges = [...edgesByIssue.values()].find(edges => edges.length >= 2);
      assert(twoEdges);
      const labelByPhysical = sourceRowsByPhysicalID(fixture.tables.label);
      const labelNames = twoEdges.slice(0, 2).map(edge => String(labelByPhysical.get(String(edge.labelID))?.name));
      const combinedIssue = fixture.tables.issue.find(issue => (
        issue.visibility === 'public' && (edgesByIssue.get(issue._id)?.length ?? 0) > 0
      ));
      assert(combinedIssue);
      const combinedCreator = sourceUserForPhysical(fixture, combinedIssue.creatorID);
      const combinedLabel = labelByPhysical.get(String(edgesByIssue.get(combinedIssue._id)?.[0].labelID));
      assert(combinedCreator && combinedLabel);
      const cases: Array<{name: string; context: ListContext; actor: ActorId; client: QueryClient}> = [
        {name: 'open', context: defaultListContext({open: true}), actor: 'ordinary-user', client: ordinary},
        {name: 'closed', context: defaultListContext({open: false}), actor: 'ordinary-user', client: ordinary},
        {name: 'creator', context: defaultListContext({creator: String(creator.login)}), actor: 'ordinary-user', client: ordinary},
        {name: 'assignee', context: defaultListContext({assignee: String(assignee.login)}), actor: 'crew-admin', client: actorClient('crew-admin')},
        {name: 'one-label', context: defaultListContext({labels: [labelNames[0]]}), actor: 'ordinary-user', client: ordinary},
        {name: 'two-label-all-selected', context: defaultListContext({labels: labelNames}), actor: 'ordinary-user', client: ordinary},
        {name: 'title-search', context: defaultListContext({textFilter: 'AST `field` should be split'}), actor: 'ordinary-user', client: ordinary},
        {name: 'description-search', context: defaultListContext({textFilter: 'All `fields` should be tuples'}), actor: 'ordinary-user', client: ordinary},
        {name: 'comment-search', context: defaultListContext({textFilter: 'Valita does not clone'}), actor: 'ordinary-user', client: ordinary},
        {name: 'project-restriction', context: defaultListContext({projectName: 'missing-project'}), actor: 'ordinary-user', client: ordinary},
        {
          name: 'combined',
          context: defaultListContext({
            open: Boolean(combinedIssue.open),
            creator: String(combinedCreator.login),
            labels: [String(combinedLabel.name)],
            textFilter: String(combinedIssue.title),
          }),
          actor: 'ordinary-user',
          client: ordinary,
        },
      ];
      for (const testCase of cases) {
        const envelope = await queryRow(testCase.client, 'issueListV2', {
          listContext: testCase.context,
          limit: 1_023,
          start: null,
          dir: 'forward',
          inclusive: false,
        });
        assert.deepEqual(
          issueIDs(envelope),
          oracleIssueList(fixture, testCase.context, testCase.actor).map(sourceID),
          testCase.name,
        );
        assert.equal(envelope.status, 'complete', `${testCase.name} complete`);
      }
    });

    await check('list-four-sort-modes-and-bidirectional-keysets', async () => {
      for (const sortField of ['created', 'modified'] as const) {
        for (const sortDirection of ['asc', 'desc'] as const) {
          const context = defaultListContext({sortField, sortDirection});
          for (const dir of ['forward', 'backward'] as const) {
            const expected = oracleIssueList(
              fixture,
              context,
              'ordinary-user',
              dir === 'backward' ? 'backward' : 'forward',
            ).map(sourceID);
            const observed: string[] = [];
            let start: JsonRecord | null = null;
            for (let page = 0; page < 1_024; page += 1) {
              const envelope = await queryRow(ordinary, 'issueListV2', {
                listContext: context, limit: 37, start, dir, inclusive: false,
              });
              observed.push(...issueIDs(envelope));
              if (!bool(envelope.hasMore, 'list hasMore')) {
                assert.equal(envelope.status, 'complete');
                break;
              }
              assert.equal(envelope.status, 'incomplete');
              start = record(envelope.cursor, 'list cursor');
            }
            assert.deepEqual(observed, expected, `${sortField}/${sortDirection}/${dir}`);
            assert.equal(new Set(observed).size, observed.length, 'no cursor duplicates');
          }
        }
      }
    });

    await check('deprecated-list-and-prev-next-share-oracle', async () => {
      const context = defaultListContext({open: true, sortField: 'created', sortDirection: 'asc'});
      const expected = oracleIssueList(fixture, context, 'ordinary-user');
      assert(expected.length > 4);
      const legacy = await queryRow(ordinary, 'issueList', {listContext: context, limit: 17});
      assert.deepEqual(issueIDs(legacy), expected.slice(0, 17).map(sourceID));
      assert.equal(legacy.status, 'incomplete');

      const pivotIndex = Math.floor(expected.length / 2);
      const pivot = expected[pivotIndex];
      const next = await queryRow(ordinary, 'prevNext', {
        listContext: context,
        issue: sourceIssueCursor(pivot),
        dir: 'next',
      });
      const prev = await queryRow(ordinary, 'prevNext', {
        listContext: context,
        issue: sourceIssueCursor(pivot),
        dir: 'prev',
      });
      assert.deepEqual(issueIDs(next), [sourceID(expected[pivotIndex + 1])]);
      assert.deepEqual(issueIDs(prev), [sourceID(expected[pivotIndex - 1])]);
    });

    await check('permalink-inside-outside-window-and-authoritative-not-found', async () => {
      const context = defaultListContext();
      const expected = oracleIssueList(fixture, context, 'ordinary-user');
      assert(expected.length > 3);
      const window = await queryRow(ordinary, 'issueListV2', {
        listContext: context, limit: 2, start: null, dir: 'forward', inclusive: false,
      });
      assert.equal(window.status, 'incomplete');
      const inside = expected[0];
      const outside = expected.at(-1);
      assert(outside);
      for (const issue of [inside, outside]) {
        const permalink = await queryRow(ordinary, 'listIssueByID', {
          listContext: context, idField: 'id', idValue: sourceID(issue),
        });
        assert.deepEqual(issueIDs(permalink), [sourceID(issue)]);
      }
      assert.equal(typeof inside.shortID, 'number');
      const shortPermalink = await queryRow(ordinary, 'listIssueByID', {
        listContext: context, idField: 'shortID', idValue: inside.shortID,
      });
      assert.deepEqual(issueIDs(shortPermalink), [sourceID(inside)]);
      const missing = await queryRow(ordinary, 'listIssueByID', {
        listContext: context, idField: 'id', idValue: 'zerobugs-missing-issue',
      });
      const invisible = await queryRow(ordinary, 'listIssueByID', {
        listContext: context, idField: 'id', idValue: INTERNAL_ISSUE_ID,
      });
      assert.equal(missing.status, 'not-found-authoritative');
      assert.deepEqual(invisible, missing, 'missing and invisible list permalinks are indistinguishable');
    });

    await check('issue-detail-and-public-comment-graph-parity', async () => {
      const publicIssue = fixture.tables.issue.find(issue => (
        issue.visibility === 'public'
        && fixture.tables.comment.some(comment => comment.issueID === issue._id)
      ));
      assert(publicIssue);
      const detail = await queryRow(ordinary, 'issueDetail', {idField: 'id', id: sourceID(publicIssue)});
      const value = record(detail.value, 'issueDetail.value');
      assert.equal(record(value.issue, 'detail issue').id, sourceID(publicIssue));
      assert.deepEqual(
        array(value.labels, 'detail labels').map((label, index) => text(record(label, `label ${index}`).id, 'label id')),
        expectedLabelsForIssue(fixture, publicIssue),
      );
      assert.deepEqual(
        array(value.comments, 'detail comments').map((comment, index) => (
          text(record(record(comment, `comment ${index}`).comment, 'comment row').id, 'comment id')
        )),
        expectedCommentIDs(fixture, publicIssue, 50),
      );
      assert.equal(typeof publicIssue.shortID, 'number');
      const detailByShortID = await queryRow(ordinary, 'issueDetail', {
        idField: 'shortID', id: publicIssue.shortID,
      });
      assert.equal(
        record(record(detailByShortID.value, 'short detail value').issue, 'short detail issue').id,
        sourceID(publicIssue),
      );
      const permalinkSource = fixture.tables.comment.find(comment => comment.issueID === publicIssue._id);
      assert(permalinkSource);
      const permalink = await queryRow(ordinary, 'comment', {id: sourceID(permalinkSource)});
      assert.equal(
        record(record(permalink.value, 'comment value').comment, 'comment row').id,
        sourceID(permalinkSource),
      );
    });

    await check('public-comments-and-emoji-pages-match-source-rows', async () => {
      const publicIssue = fixture.tables.issue
        .filter(issue => issue.visibility === 'public')
        .sort((left, right) => (
          fixture.tables.comment.filter(comment => comment.issueID === right._id).length
          - fixture.tables.comment.filter(comment => comment.issueID === left._id).length
        ))[0];
      assert(publicIssue);
      const comments = fixture.tables.comment
        .filter(comment => comment.issueID === publicIssue._id)
        .sort((left, right) => Number(left.created) - Number(right.created) || compareText(sourceID(left), sourceID(right)));
      assert(comments.length > 7, 'comment cursor fixture spans multiple pages');
      for (const dir of ['forward', 'backward'] as const) {
        const observed: string[] = [];
        let start: JsonRecord | null = null;
        for (;;) {
          const page = await queryRow(ordinary, 'commentsPage', {
            issueID: sourceID(publicIssue), limit: 7, start, dir, inclusive: false,
          });
          observed.push(...resultItems(page).map(item => text(record(item.comment, 'comment').id, 'comment id')));
          if (!page.hasMore) break;
          start = record(page.cursor, 'comment cursor');
        }
        assert.deepEqual(
          observed,
          (dir === 'forward' ? comments : [...comments].reverse()).map(sourceID),
          `commentsPage ${dir}`,
        );
        assert.equal(new Set(observed).size, observed.length, 'comment walk has no duplicates');
      }
      const issueEmoji = fixture.tables.emoji.filter(emoji => emoji.subjectID === publicIssue._id);
      const emoji = await queryRow(ordinary, 'emojiChange', {
        subjectID: sourceID(publicIssue), limit: 1_023, start: null,
      });
      assert.equal(emoji.subjectKind, 'issue');
      assert.deepEqual(
        resultItems(emoji).map(item => text(record(item.emoji, 'emoji').id, 'emoji id')),
        issueEmoji
          .sort((left, right) => Number(left.created) - Number(right.created) || compareText(sourceID(left), sourceID(right)))
          .map(sourceID),
      );
    });

    await check('internal-policy-visibility-list-detail-preload', async () => {
      for (const actor of ['crew-admin', 'removed-member'] as const) {
        const client = actorClient(actor);
        const list = await queryRow(client, 'issueListV2', {
          listContext: defaultListContext(), limit: 1_023, start: null, dir: 'forward', inclusive: false,
        });
        assert(issueIDs(list).includes(INTERNAL_ISSUE_ID), `${actor} list sees internal issue`);
        assert.equal(list.examined, oracleIssueList(fixture, defaultListContext(), actor).length);
        assert.equal(list.total, oracleIssueList(fixture, defaultListContext(), actor).length);
        const detail = await queryRow(client, 'issueDetail', {idField: 'id', id: INTERNAL_ISSUE_ID});
        assert.equal(record(record(detail.value, 'detail value').issue, 'issue').id, INTERNAL_ISSUE_ID);
        const preload = await queryRow(client, 'issuePreloadV2', {projectName: 'Zero'});
        assert(issueIDs(preload).includes(INTERNAL_ISSUE_ID), `${actor} preload sees internal issue`);
      }
      const nonCrew: Array<{name: string; client: QueryClient}> = [
        {name: 'ordinary-user', client: ordinary},
        {name: 'creator', client: actorClient('creator')},
        {name: 'assignee', client: actorClient('assignee')},
        {name: 'anonymous', client: anonymousClient},
      ];
      for (const actor of nonCrew) {
        const list = await queryRow(actor.client, 'issueListV2', {
          listContext: defaultListContext(), limit: 1_023, start: null, dir: 'forward', inclusive: false,
        });
        assert(!issueIDs(list).includes(INTERNAL_ISSUE_ID), `${actor.name} list hides internal issue`);
        assert.equal(list.examined, oracleIssueList(fixture, defaultListContext(), null).length);
        assert.equal(list.total, oracleIssueList(fixture, defaultListContext(), null).length);
        const detail = await queryRow(actor.client, 'issueDetail', {idField: 'id', id: INTERNAL_ISSUE_ID});
        assert.equal(detail.status, 'not-found-authoritative', `${actor.name} detail hides internal issue`);
        const preload = await queryRow(actor.client, 'issuePreloadV2', {projectName: 'Zero'});
        assert(!issueIDs(preload).includes(INTERNAL_ISSUE_ID), `${actor.name} preload hides internal issue`);
      }
    });

    await check('child-roots-prove-parent-before-release', async () => {
      const crew = actorClient('crew-admin');
      const internalPage = await queryRow(crew, 'commentsPage', {
        issueID: INTERNAL_ISSUE_ID, limit: 100, start: null, dir: 'forward', inclusive: false,
      });
      assert(issueIDs({items: resultItems(internalPage).map(item => ({issue: {id: record(item.comment, 'comment').issueID}}))}).every(id => id === INTERNAL_ISSUE_ID));
      assert(resultItems(internalPage).some(item => record(item.comment, 'comment').id === INTERNAL_COMMENT_ID));
      const internalComment = await queryRow(crew, 'comment', {id: INTERNAL_COMMENT_ID});
      assert.equal(record(record(internalComment.value, 'comment value').comment, 'comment').id, INTERNAL_COMMENT_ID);
      const issueEmoji = await queryRow(crew, 'emojiChange', {
        subjectID: INTERNAL_ISSUE_ID, limit: 100, start: null,
      });
      assert.equal(issueEmoji.subjectKind, 'issue');
      const commentEmoji = await queryRow(crew, 'emojiChange', {
        subjectID: INTERNAL_COMMENT_ID, limit: 100, start: null,
      });
      assert.equal(commentEmoji.subjectKind, 'comment');
      assert.deepEqual(
        resultItems(commentEmoji).map(item => text(record(item.emoji, 'emoji').id, 'emoji id')),
        ['zbav1_internal_comment_emoji'],
      );

      for (const client of [ordinary, actorClient('creator'), actorClient('assignee'), anonymousClient]) {
        const missingPage = await queryRow(client, 'commentsPage', {
          issueID: 'zerobugs-missing-issue', limit: 100, start: null, dir: 'forward', inclusive: false,
        });
        const hiddenPage = await queryRow(client, 'commentsPage', {
          issueID: INTERNAL_ISSUE_ID, limit: 100, start: null, dir: 'forward', inclusive: false,
        });
        assert.deepEqual(hiddenPage, missingPage, 'missing and invisible comment pages are indistinguishable');
        const missingComment = await queryRow(client, 'comment', {id: 'zerobugs-missing-comment'});
        const hiddenComment = await queryRow(client, 'comment', {id: INTERNAL_COMMENT_ID});
        assert.deepEqual(hiddenComment, missingComment, 'missing and invisible comments are indistinguishable');
        const missingEmoji = await queryRow(client, 'emojiChange', {
          subjectID: 'zerobugs-missing-subject', limit: 100, start: null,
        });
        const hiddenEmoji = await queryRow(client, 'emojiChange', {
          subjectID: INTERNAL_ISSUE_ID, limit: 100, start: null,
        });
        assert.deepEqual(hiddenEmoji, missingEmoji, 'missing and invisible emoji subjects are indistinguishable');
      }
    });

    await check('principal-overlays-never-cross-actor-boundaries', async () => {
      const internalIssue = sourceIssue(fixture, INTERNAL_ISSUE_ID);
      for (const actor of ACTOR_IDS) {
        const client = actorClient(actor);
        const sourceUserID = fixture.actors[actor].sourceUserID;
        const expectedPref = fixture.tables.userPref.find(pref => (
          pref.userID === fixture.actors[actor].userID && pref.key === PREF_KEY
        ));
        assert(expectedPref);
        const pref = await queryRow(client, 'userPref', {key: PREF_KEY});
        const prefValue = record(pref.value, 'userPref.value');
        assert.equal(prefValue.userID, sourceUserID);
        assert.equal(prefValue.value, expectedPref.value);

        const list = await queryRow(client, 'issueListV2', {
          listContext: defaultListContext(), limit: 1_023, start: null, dir: 'forward', inclusive: false,
        });
        const overlays = resultItems(list)
          .map(item => item.viewState)
          .filter((value): value is JsonRecord => value !== null)
          .map(value => record(value, 'list viewState'));
        assert(overlays.every(value => value.userID === sourceUserID), `${actor} list overlay owner`);
        const expectedVisibleViewRows = fixture.tables.viewState.filter(view => (
          view.userID === fixture.actors[actor].userID
          && visibleSourceIssues(fixture, actor).some(issue => issue._id === view.issueID)
        ));
        assert.equal(overlays.length, expectedVisibleViewRows.length, `${actor} visible view row count`);

        const detail = await queryRow(client, 'issueDetail', {idField: 'id', id: INTERNAL_ISSUE_ID});
        if (fixture.actors[actor].role === 'crew') {
          const value = record(detail.value, 'internal detail value');
          const expectedView = fixture.tables.viewState.find(view => (
            view.issueID === internalIssue._id && view.userID === fixture.actors[actor].userID
          ));
          const expectedNotification = fixture.tables.issueNotifications.find(notification => (
            notification.issueID === internalIssue._id
            && notification.userID === fixture.actors[actor].userID
          ));
          assert(expectedView && expectedNotification);
          assert.equal(record(value.viewState, 'detail viewState').userID, sourceUserID);
          assert.equal(record(value.notificationState, 'notificationState').userID, sourceUserID);
          assert.equal(record(value.notificationState, 'notificationState').subscribed, expectedNotification.subscribed);
        } else {
          assert.equal(detail.status, 'not-found-authoritative');
          assert.equal(detail.value, null);
        }
      }
    });

    await check('small-window-declares-incompleteness', async () => {
      const page = await queryRow(ordinary, 'issueListV2', {
        listContext: defaultListContext(), limit: 2, start: null, dir: 'forward', inclusive: false,
      });
      assert.equal(page.status, 'incomplete');
      assert.equal(page.reason, 'page-limit');
      assert.equal(page.hasMore, true);
      assert(page.cursor, 'incomplete page exposes stable continuation cursor');
      assert.equal(resultItems(page).length, 2);
      const nullLimit = await queryRow(ordinary, 'issueListV2', {
        listContext: defaultListContext(), limit: null, start: null, dir: 'forward', inclusive: false,
      });
      assert.equal(nullLimit.status, 'incomplete');
      assert.equal(nullLimit.reason, 'positive-limit-required');
      assert.deepEqual(resultItems(nullLimit), []);
    });

    await check('preload-graph-has-bounded-child-facts', async () => {
      const preload = await queryRow(ordinary, 'issuePreloadV2', {projectName: 'Zero'});
      const expected = oracleIssueList(fixture, defaultListContext(), 'ordinary-user');
      assert.deepEqual(issueIDs(preload), expected.slice(0, 1_000).map(sourceID));
      for (const item of resultItems(preload)) {
        assert(['complete', 'incomplete', 'refreshing', 'not-found-authoritative'].includes(String(item.labelsCompleteness)));
        assert(['complete', 'incomplete', 'refreshing', 'not-found-authoritative'].includes(String(item.emojiCompleteness)));
        assert(['complete', 'incomplete', 'refreshing', 'not-found-authoritative'].includes(String(item.commentsCompleteness)));
        assert(array(item.comments, 'preload comments').length <= 10);
      }
    });

    await check('all-frozen-query-names-exercised', async () => {
      assert.deepEqual([...exercised].sort(), [...FROZEN_QUERY_NAMES].sort());
    });

    assert.equal(checks.length, EXPECTED_CHECKS, 'receipt check count is frozen');
    const failed = checks.filter(checkResult => checkResult.status === 'fail');
    const receipt = {
      schemaVersion: 'zerobugs-lane3-live.v1',
      status: failed.length === 0 ? 'ok' : 'failed',
      expectedChecks: EXPECTED_CHECKS,
      executedChecks: checks.length,
      fixture: {
        overallDigest: loaded.overallDigest,
        batches: loaded.batches,
      },
      actorBindings: bound.receipt.actors,
      checks,
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (failed.length > 0) {
      throw new Error(`ZBUGS_LANE3_LIVE_FAILED: ${failed.length} parity check(s) failed`);
    }
  } finally {
    const cleanup = await Promise.allSettled([
      ...(anonymous ? [anonymous.closeAuth()] : []),
      ...(bound ? [bound.close()] : []),
    ]);
    const rejected = cleanup.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
