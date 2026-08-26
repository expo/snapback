import * as graph from '@expo/snapback-codegen/define';
import {
  identityBinding, issue, issueListRead, issueNotifications, viewState,
} from './schema.mjs';

// Corpus-local D2 declarations. They deliberately do not reuse the D1
// control oracle: the canonical freezer independently projects the exact
// list/detail bytes from the frozen Zerobugs rows, and Rust executes the same
// carriers through the evaluator and retained scheduler.
//
// @ref LLP 0209#3-authorization-at-every-node — both private relations are
// principal-bound class-3 nodes and therefore force a partition of one.

export const issueListPrivateOverlays = graph.defineGraphQuery({
  nodes: [
    {
      nodeId: 'listRoot', kind: 'root-window', edgeName: '$root', authorityClass: 2,
      table: issueListRead,
      filters: [{field: 'sourceIssueID', op: 'Eq', value: graph.arg('sourceIssueID')}],
      accessIndex: 'by_source_issue_id', order: [graph.asc('sourceIssueID')],
    },
    {
      nodeId: 'listIssue', kind: 'equality-to-one', edgeName: 'issue',
      authorityClass: 2, parentNodeId: 'listRoot', table: issue,
      joinOn: [{rootField: 'issueID', joinedField: '_id'}],
      accessIndex: 'by_id', presence: 'required',
    },
    {
      nodeId: 'listViewState', kind: 'principal-bound', edgeName: 'viewState',
      authorityClass: 3, parentNodeId: 'listRoot', table: viewState,
      parentJoin: [{rootField: 'issueID', joinedField: 'issueID'}],
      principalField: 'userID', accessIndex: 'by_issue_user', binding: {
        table: identityBinding, principalField: 'principal', valueField: 'userID',
        uniqueIndex: 'by_principal',
      },
    },
    {
      nodeId: 'listNotificationState', kind: 'principal-bound',
      edgeName: 'notificationState', authorityClass: 3, parentNodeId: 'listRoot',
      table: issueNotifications,
      parentJoin: [{rootField: 'issueID', joinedField: 'issueID'}],
      principalField: 'userID', accessIndex: 'by_issue_user', binding: {
        table: identityBinding, principalField: 'principal', valueField: 'userID',
        uniqueIndex: 'by_principal',
      },
    },
  ],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 3,
    object: {scopeNodeId: 'listRoot', fields: [
      {name: 'issue', value: {kind: 'object', nodeId: 'listIssue', object: {
        scopeNodeId: 'listRoot', fields: [
          {name: 'id', value: {kind: 'field', nodeId: 'listIssue', field: 'id'}},
          {name: 'title', value: {kind: 'field', nodeId: 'listIssue', field: 'title'}},
        ],
      }}},
      {name: 'viewState', value: {kind: 'object', nodeId: 'listViewState', object: {
        scopeNodeId: 'listRoot', fields: [
          {name: 'viewed', value: {kind: 'field', nodeId: 'listViewState', field: 'viewed'}},
        ],
      }}},
      {name: 'notificationState', value: {
        kind: 'object', nodeId: 'listNotificationState', object: {
          scopeNodeId: 'listRoot', fields: [
            {name: 'subscribed', value: {
              kind: 'field', nodeId: 'listNotificationState', field: 'subscribed',
            }},
          ],
        },
      }},
    ]},
  },
  args: {sourceIssueID: graph.v.string({maxBytes: 128})},
  bounds: {
    maxScannedRows: 7, maxIndexRanges: 6, maxResultRows: 1,
    maxResultBytes: 1_048_576, maxEvaluationTurnMs: 1_000,
    maxObservers: 1_024, maxDistinctEvaluationGroups: 1_024,
    maxEstimatedLiveFanoutMs: 5_000,
  },
  queryCost: {graph: {
    nodes: [
      {
        nodeId: 'listRoot', maxRootRowsPerPage: 1,
        maxExaminedEntriesPerExecution: 2, maxWindowPages: 1,
        maxWindowRootRows: 1, maxWindowScannedRows: 7,
        maxWindowResultRows: 1, maxWindowResultBytes: 1_048_576,
        maxWindowIndexRanges: 6,
      },
      {
        nodeId: 'listIssue', maxExaminedEntriesPerExecution: 1,
        maxRelationshipLookupsPerExecution: 1,
      },
      {
        nodeId: 'listViewState', maxExaminedEntriesPerExecution: 2,
        maxRelationshipLookupsPerExecution: 2,
      },
      {
        nodeId: 'listNotificationState', maxExaminedEntriesPerExecution: 2,
        maxRelationshipLookupsPerExecution: 2,
      },
    ],
    arguments: [], maxArgumentItems: 1, maxPageResultBytes: 1_048_576,
    windowRollup: {
      maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 7,
      maxWindowResultRows: 1, maxWindowResultBytes: 1_048_576,
      maxWindowIndexRanges: 6,
    },
    maxMaintainedWritesPerMutation: 0,
  }},
  broadcast: {classification: 'query-shaped'},
});

export const issueDetailPrivateOverlays = graph.defineGraphQuery({
  nodes: [
    {
      nodeId: 'detailRoot', kind: 'root-window', edgeName: '$root', authorityClass: 2,
      table: issue,
      filters: [{field: 'id', op: 'Eq', value: graph.arg('sourceIssueID')}],
      accessIndex: 'by_source_id', order: [graph.asc('id')],
    },
    {
      nodeId: 'detailViewState', kind: 'principal-bound', edgeName: 'viewState',
      authorityClass: 3, parentNodeId: 'detailRoot', table: viewState,
      parentJoin: [{rootField: '_id', joinedField: 'issueID'}],
      principalField: 'userID', accessIndex: 'by_issue_user', binding: {
        table: identityBinding, principalField: 'principal', valueField: 'userID',
        uniqueIndex: 'by_principal',
      },
    },
    {
      nodeId: 'detailNotificationState', kind: 'principal-bound',
      edgeName: 'notificationState', authorityClass: 3, parentNodeId: 'detailRoot',
      table: issueNotifications,
      parentJoin: [{rootField: '_id', joinedField: 'issueID'}],
      principalField: 'userID', accessIndex: 'by_issue_user', binding: {
        table: identityBinding, principalField: 'principal', valueField: 'userID',
        uniqueIndex: 'by_principal',
      },
    },
  ],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 3,
    object: {scopeNodeId: 'detailRoot', fields: [
      {name: 'issueId', value: {kind: 'field', nodeId: 'detailRoot', field: 'id'}},
      {name: 'issueTitle', value: {kind: 'field', nodeId: 'detailRoot', field: 'title'}},
      {name: 'viewState', value: {kind: 'object', nodeId: 'detailViewState', object: {
        scopeNodeId: 'detailRoot', fields: [
          {name: 'viewed', value: {kind: 'field', nodeId: 'detailViewState', field: 'viewed'}},
        ],
      }}},
      {name: 'notificationState', value: {
        kind: 'object', nodeId: 'detailNotificationState', object: {
          scopeNodeId: 'detailRoot', fields: [
            {name: 'subscribed', value: {
              kind: 'field', nodeId: 'detailNotificationState', field: 'subscribed',
            }},
          ],
        },
      }},
    ]},
  },
  args: {sourceIssueID: graph.v.string({maxBytes: 128})},
  bounds: {
    maxScannedRows: 6, maxIndexRanges: 5, maxResultRows: 1,
    maxResultBytes: 1_048_576, maxEvaluationTurnMs: 1_000,
    maxObservers: 1_024, maxDistinctEvaluationGroups: 1_024,
    maxEstimatedLiveFanoutMs: 5_000,
  },
  queryCost: {graph: {
    nodes: [
      {
        nodeId: 'detailRoot', maxRootRowsPerPage: 1,
        maxExaminedEntriesPerExecution: 2, maxWindowPages: 1,
        maxWindowRootRows: 1, maxWindowScannedRows: 6,
        maxWindowResultRows: 1, maxWindowResultBytes: 1_048_576,
        maxWindowIndexRanges: 5,
      },
      {
        nodeId: 'detailViewState', maxExaminedEntriesPerExecution: 2,
        maxRelationshipLookupsPerExecution: 2,
      },
      {
        nodeId: 'detailNotificationState', maxExaminedEntriesPerExecution: 2,
        maxRelationshipLookupsPerExecution: 2,
      },
    ],
    arguments: [], maxArgumentItems: 1, maxPageResultBytes: 1_048_576,
    windowRollup: {
      maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 6,
      maxWindowResultRows: 1, maxWindowResultBytes: 1_048_576,
      maxWindowIndexRanges: 5,
    },
    maxMaintainedWritesPerMutation: 0,
  }},
  broadcast: {classification: 'query-shaped'},
});
