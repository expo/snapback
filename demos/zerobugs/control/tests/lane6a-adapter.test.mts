import {describe, expect, test} from 'bun:test';

import {
  collectPages,
  deriveAdapterResult,
  QUERY_REFS,
} from '../src/data/queries';

const user = Object.freeze({
  id: 'source-user-1',
  login: 'reader',
  avatar: 'https://example.invalid/avatar',
  role: 'user' as const,
});

const live = Object.freeze({connection: 'live' as const, freshness: 'current' as const});

describe('Lane 6a query adapter', () => {
  test('covers all 19 generated query references', () => {
    expect(Object.keys(QUERY_REFS).sort()).toEqual([
      'allLabels', 'allProjects', 'allUsers', 'comment', 'commentsPage',
      'crewUser', 'emojiChange', 'issueDetail', 'issueList', 'issueListV2',
      'issuePreloadV2', 'labels', 'labelsOrderByName', 'listIssueByID',
      'prevNext', 'user', 'userPicker', 'userPref', 'usersForProject',
    ]);
  });

  test('derives pending, incomplete, refreshing, complete, not-found, and refusal', () => {
    expect(deriveAdapterResult('allUsers', {
      status: 'pending', data: undefined, error: null, connection: 'connecting', freshness: 'unknown',
    }).status).toBe('pending');

    const incomplete = deriveAdapterResult('allUsers', {
      status: 'ready',
      data: [{
        status: 'incomplete', reason: 'page-limit', hasMore: true,
        cursor: {id: user.id, login: user.login}, examined: 1, total: 2, items: [user],
      }],
      error: null,
      ...live,
    });
    expect(incomplete.status).toBe('incomplete');
    if (incomplete.status === 'incomplete') expect(incomplete.value.items).toEqual([user]);

    const refreshing = deriveAdapterResult('allUsers', {
      status: 'refreshing',
      data: [{
        status: 'complete', reason: null, hasMore: false,
        cursor: null, examined: 1, total: 1, items: [user],
      }],
      error: null,
      connection: 'stale',
      freshness: 'retained',
    });
    expect(refreshing.status).toBe('refreshing');
    expect(refreshing.freshness).toBe('retained');

    expect(deriveAdapterResult('allUsers', {
      status: 'ready',
      data: [{
        status: 'complete', reason: null, hasMore: false,
        cursor: null, examined: 1, total: 1, items: [user],
      }],
      error: null,
      ...live,
    }).status).toBe('complete');

    expect(deriveAdapterResult('user', {
      status: 'ready',
      data: [{status: 'not-found-authoritative', reason: 'missing', value: null}],
      error: null,
      ...live,
    }).status).toBe('not-found-authoritative');

    const refused = deriveAdapterResult('allUsers', {
      status: 'error',
      data: undefined,
      error: {diagnostic: {code: 'SNAPBACK_POLICY_REFUSED', message: 'no'}},
      connection: 'error',
      freshness: 'unknown',
    });
    expect(refused.status).toBe('refused');
    if (refused.status === 'refused') expect(refused.refusal.code).toBe('SNAPBACK_POLICY_REFUSED');
  });

  test('preserves child completeness and refuses contradictory child facts', () => {
    const frame = {
      status: 'incomplete', reason: 'child-bound', hasMore: false, cursor: null,
      examined: 1, total: 1, searchEpoch: [],
      items: [{
        issue: {
          id: 'issue-1', title: 'bounded graph', open: true, modified: 2, created: 1,
          projectID: 'project-1', creatorID: user.id, description: '', visibility: 'public',
        },
        labels: [], labelsCompleteness: 'incomplete', viewState: null,
      }],
    } as const;
    const result = deriveAdapterResult('issueListV2', {
      status: 'ready', data: [frame], error: null, ...live,
    });
    expect(result.status).toBe('incomplete');
    if (result.status === 'incomplete') {
      expect(result.value.items[0]?.completeness.labels).toBe('incomplete');
    }

    const malformed = deriveAdapterResult('issueListV2', {
      status: 'ready',
      data: [{...frame, items: [{...frame.items[0], labelsCompleteness: 'probably'}]}],
      error: null,
      ...live,
    });
    expect(malformed.status).toBe('refused');
    if (malformed.status === 'refused') {
      expect(malformed.refusal.code).toBe('ZBUGS_ADAPTER_CHILD_COMPLETENESS_REFUSED');
    }
  });

  test('manual page assembly preserves proof and refuses duplicate source ids', async () => {
    let nextCalls = 0;
    const result = await collectPages({
      first: async () => ({
        status: 'incomplete', value: {
          items: [{id: 'a'}], hasMore: true, cursor: {id: 'a'}, examined: 1, total: 2,
        }, reason: 'page-limit', ...live,
      }),
      next: async () => {
        nextCalls += 1;
        return {
          status: 'complete', value: {
            items: [{id: 'b'}], hasMore: false, cursor: null, examined: 1, total: 1,
          }, reason: null, ...live,
        };
      },
    });
    expect(nextCalls).toBe(1);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') expect(result.value).toEqual([{id: 'a'}, {id: 'b'}]);

    const duplicate = await collectPages({
      first: async () => ({
        status: 'incomplete', value: {
          items: [{id: 'same'}], hasMore: true, cursor: {id: 'same'}, examined: 1, total: 2,
        }, reason: 'page-limit', ...live,
      }),
      next: async () => ({
        status: 'complete', value: {
          items: [{id: 'same'}], hasMore: false, cursor: null, examined: 1, total: 1,
        }, reason: null, ...live,
      }),
    });
    expect(duplicate.status).toBe('refused');
  });
});
