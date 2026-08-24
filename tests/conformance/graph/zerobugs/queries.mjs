import * as graph from '@expo/snapback-codegen/define';
import {
  comment, identityBinding, issue, issueLabelRead, issueListRead, label,
  issueNotifications, project, user, viewState,
} from './schema.mjs';

// The large fixture is receipt-only in this worktree. The declared 1,024
// comment cap uses the normal per-issue maximum plus conservative headroom
// against the documented seed-42 exponential generator; zb5 will exact-check
// the absent CSV maximum. See bound-derivation.v1.json.

// Non-search list shape. The full control surface has a separately executable
// search-membership refusal in refusal-candidates.mjs.
// @ref LLP 0209#26-bounds-and-fixture-derivation — logical fields come from
// fixture maxima; physical fields exactly instantiate the G2 formulas.
export const issueListV2 = graph.defineGraphQuery({
  nodes: [
    {
      nodeId: 'listRoot', kind: 'root-window', edgeName: '$root', authorityClass: 1,
      table: issueListRead,
      filters: [{ field: 'projectID', op: 'Eq', value: graph.arg('projectID') }],
      accessIndex: 'by_project_modified',
      order: [graph.desc('modified'), graph.desc('sourceIssueID')],
    },
    {
      nodeId: 'issueRow', kind: 'equality-to-one', edgeName: 'issue', authorityClass: 1,
      parentNodeId: 'listRoot', table: issue,
      joinOn: [{ rootField: 'issueID', joinedField: '_id' }],
      accessIndex: 'by_id', presence: 'required',
    },
    {
      nodeId: 'labelEdges', kind: 'bounded-to-many', edgeName: 'labels', authorityClass: 1,
      parentNodeId: 'listRoot', table: issueLabelRead,
      joinOn: [{ rootField: 'issueID', joinedField: 'issueID' }],
      accessIndex: 'by_issue_label', order: [graph.asc('labelID')],
      page: { kind: 'literal', direction: 'forward', lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' }, take: 16 },
    },
    {
      nodeId: 'labelRow', kind: 'equality-to-one', edgeName: 'label', authorityClass: 1,
      parentNodeId: 'labelEdges', table: label,
      joinOn: [{ rootField: 'labelID', joinedField: '_id' }],
      accessIndex: 'by_id', presence: 'required',
    },
    {
      nodeId: 'selectedLabels', kind: 'exists-semi-join', edgeName: 'selectedLabels',
      authorityClass: 1, parentNodeId: 'listRoot', mode: 'all',
      edge: {
        kind: 'direct', table: issueLabelRead,
        joinOn: [{ rootField: 'issueID', joinedField: 'issueID' }],
        accessIndex: 'by_issue_label',
      },
      filters: [{ field: 'labelID', op: 'In', value: graph.arg('selectedLabelIDs') }],
      argumentId: 'selectedLabelIDs',
    },
    {
      nodeId: 'viewState', kind: 'principal-bound', edgeName: 'viewState', authorityClass: 3,
      parentNodeId: 'listRoot', table: viewState,
      parentJoin: [{ rootField: 'issueID', joinedField: 'issueID' }],
      principalField: 'userID', accessIndex: 'by_issue_user',
      binding: {
        table: identityBinding, principalField: 'principal', valueField: 'userID',
        uniqueIndex: 'by_principal',
      },
    },
  ],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 3,
    object: {
      scopeNodeId: 'listRoot', fields: [
        { name: 'issue', value: { kind: 'object', nodeId: 'issueRow', object: { scopeNodeId: 'listRoot', fields: [
          { name: 'id', value: { kind: 'field', nodeId: 'issueRow', field: 'id' } },
          { name: 'shortID', value: { kind: 'field', nodeId: 'issueRow', field: 'shortID' } },
          { name: 'title', value: { kind: 'field', nodeId: 'issueRow', field: 'title' } },
          { name: 'open', value: { kind: 'field', nodeId: 'issueRow', field: 'open' } },
          { name: 'modified', value: { kind: 'field', nodeId: 'issueRow', field: 'modified' } },
          { name: 'created', value: { kind: 'field', nodeId: 'issueRow', field: 'created' } },
          { name: 'description', value: { kind: 'field', nodeId: 'issueRow', field: 'description' } },
        ] } } },
        { name: 'labels', value: { kind: 'array', scopeNodeId: 'labelEdges', item: { scopeNodeId: 'labelEdges', fields: [
          { name: 'label', value: { kind: 'object', nodeId: 'labelRow', object: { scopeNodeId: 'labelEdges', fields: [
            { name: 'id', value: { kind: 'field', nodeId: 'labelRow', field: 'id' } },
            { name: 'name', value: { kind: 'field', nodeId: 'labelRow', field: 'name' } },
          ] } } },
        ] } } },
        { name: 'viewState', value: { kind: 'object', nodeId: 'viewState', object: { scopeNodeId: 'listRoot', fields: [
          { name: 'viewed', value: { kind: 'field', nodeId: 'viewState', field: 'viewed' } },
        ] } } },
      ],
    },
  },
  args: {
    projectID: graph.v.string({ maxBytes: 128 }),
    selectedLabelIDs: graph.v.array(graph.v.string({ maxBytes: 128 }), { maxItems: 16 }),
  },
  bounds: {
    maxScannedRows: 54_273, maxIndexRanges: 36_865, maxResultRows: 1_024,
    maxResultBytes: 33_554_432, maxEvaluationTurnMs: 1_000, maxObservers: 1_024,
    maxDistinctEvaluationGroups: 1_024, maxEstimatedLiveFanoutMs: 5_000,
  },
  queryCost: { graph: {
    nodes: [
      { nodeId: 'listRoot', maxRootRowsPerPage: 1_024, maxExaminedEntriesPerExecution: 1_025, maxWindowPages: 1, maxWindowRootRows: 1_024, maxWindowScannedRows: 54_273, maxWindowResultRows: 1_024, maxWindowResultBytes: 33_554_432, maxWindowIndexRanges: 36_865 },
      { nodeId: 'issueRow', maxExaminedEntriesPerExecution: 1_024, maxRelationshipLookupsPerExecution: 1_024 },
      { nodeId: 'labelEdges', maxExaminedEntriesPerExecution: 17_408, maxRelationshipLookupsPerExecution: 1_024, maxChildrenPerParent: 16 },
      { nodeId: 'labelRow', maxExaminedEntriesPerExecution: 16_384, maxRelationshipLookupsPerExecution: 16_384 },
      { nodeId: 'selectedLabels', maxExaminedEntriesPerExecution: 16_384, maxRelationshipLookupsPerExecution: 16_384, maxChildrenPerParent: 1, maxArgumentExpansion: 16 },
      { nodeId: 'viewState', maxExaminedEntriesPerExecution: 2_048, maxRelationshipLookupsPerExecution: 2_048 },
    ],
    arguments: [{ argumentId: 'selectedLabelIDs', maxItems: 16 }],
    maxArgumentItems: 17, maxPageResultBytes: 33_554_432,
    windowRollup: { maxWindowPages: 1, maxWindowRootRows: 1_024, maxWindowScannedRows: 54_273, maxWindowResultRows: 1_024, maxWindowResultBytes: 33_554_432, maxWindowIndexRanges: 36_865 },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: { classification: 'query-shaped' },
});

export const issueDetail = graph.defineGraphQuery({
  nodes: [
    {
      nodeId: 'issueRoot', kind: 'root-window', edgeName: '$root', authorityClass: 1,
      table: issue, filters: [{ field: 'id', op: 'Eq', value: graph.arg('sourceIssueID') }],
      accessIndex: 'by_source_id', order: [graph.asc('id')],
    },
    { nodeId: 'assignee', kind: 'equality-to-one', edgeName: 'assignee', authorityClass: 1, parentNodeId: 'issueRoot', table: user, joinOn: [{ rootField: 'assigneeID', joinedField: '_id' }], accessIndex: 'by_id', presence: 'optional' },
    { nodeId: 'comments', kind: 'bounded-to-many', edgeName: 'comments', authorityClass: 1, parentNodeId: 'issueRoot', table: comment, joinOn: [{ rootField: '_id', joinedField: 'issueID' }], accessIndex: 'by_issue_created', order: [graph.desc('created')], page: { kind: 'demand' } },
    { nodeId: 'creator', kind: 'equality-to-one', edgeName: 'creator', authorityClass: 1, parentNodeId: 'issueRoot', table: user, joinOn: [{ rootField: 'creatorID', joinedField: '_id' }], accessIndex: 'by_id', presence: 'required' },
    { nodeId: 'labelEdges', kind: 'bounded-to-many', edgeName: 'labels', authorityClass: 1, parentNodeId: 'issueRoot', table: issueLabelRead, joinOn: [{ rootField: '_id', joinedField: 'issueID' }], accessIndex: 'by_issue_label', order: [graph.asc('labelID')], page: { kind: 'literal', direction: 'forward', lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' }, take: 16 } },
    { nodeId: 'labelRow', kind: 'equality-to-one', edgeName: 'label', authorityClass: 1, parentNodeId: 'labelEdges', table: label, joinOn: [{ rootField: 'labelID', joinedField: '_id' }], accessIndex: 'by_id', presence: 'required' },
    { nodeId: 'notificationState', kind: 'principal-bound', edgeName: 'notificationState', authorityClass: 3, parentNodeId: 'issueRoot', table: issueNotifications, parentJoin: [{ rootField: '_id', joinedField: 'issueID' }], principalField: 'userID', accessIndex: 'by_issue_user', binding: { table: identityBinding, principalField: 'principal', valueField: 'userID', uniqueIndex: 'by_principal' } },
    { nodeId: 'project', kind: 'equality-to-one', edgeName: 'project', authorityClass: 1, parentNodeId: 'issueRoot', table: project, joinOn: [{ rootField: 'projectID', joinedField: '_id' }], accessIndex: 'by_id', presence: 'required' },
    { nodeId: 'viewState', kind: 'principal-bound', edgeName: 'viewState', authorityClass: 3, parentNodeId: 'issueRoot', table: viewState, parentJoin: [{ rootField: '_id', joinedField: 'issueID' }], principalField: 'userID', accessIndex: 'by_issue_user', binding: { table: identityBinding, principalField: 'principal', valueField: 'userID', uniqueIndex: 'by_principal' } },
  ],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 3,
    object: { scopeNodeId: 'issueRoot', fields: [
      { name: 'issueId', value: { kind: 'field', nodeId: 'issueRoot', field: 'id' } },
      { name: 'issueShortID', value: { kind: 'field', nodeId: 'issueRoot', field: 'shortID' } },
      { name: 'issueTitle', value: { kind: 'field', nodeId: 'issueRoot', field: 'title' } },
      { name: 'issueOpen', value: { kind: 'field', nodeId: 'issueRoot', field: 'open' } },
      { name: 'issueModified', value: { kind: 'field', nodeId: 'issueRoot', field: 'modified' } },
      { name: 'issueCreated', value: { kind: 'field', nodeId: 'issueRoot', field: 'created' } },
      { name: 'issueDescription', value: { kind: 'field', nodeId: 'issueRoot', field: 'description' } },
      { name: 'project', value: { kind: 'object', nodeId: 'project', object: { scopeNodeId: 'issueRoot', fields: [
        { name: 'id', value: { kind: 'field', nodeId: 'project', field: 'id' } },
        { name: 'name', value: { kind: 'field', nodeId: 'project', field: 'name' } },
      ] } } },
      { name: 'creator', value: { kind: 'object', nodeId: 'creator', object: { scopeNodeId: 'issueRoot', fields: [
        { name: 'id', value: { kind: 'field', nodeId: 'creator', field: 'id' } },
        { name: 'login', value: { kind: 'field', nodeId: 'creator', field: 'login' } },
      ] } } },
      { name: 'assignee', value: { kind: 'object', nodeId: 'assignee', object: { scopeNodeId: 'issueRoot', fields: [
        { name: 'id', value: { kind: 'field', nodeId: 'assignee', field: 'id' } },
        { name: 'login', value: { kind: 'field', nodeId: 'assignee', field: 'login' } },
      ] } } },
      { name: 'labels', value: { kind: 'array', scopeNodeId: 'labelEdges', item: { scopeNodeId: 'labelEdges', fields: [
        { name: 'label', value: { kind: 'object', nodeId: 'labelRow', object: { scopeNodeId: 'labelEdges', fields: [
          { name: 'id', value: { kind: 'field', nodeId: 'labelRow', field: 'id' } },
          { name: 'name', value: { kind: 'field', nodeId: 'labelRow', field: 'name' } },
        ] } } },
      ] } } },
      { name: 'comments', value: { kind: 'array', scopeNodeId: 'comments', item: { scopeNodeId: 'comments', fields: [
        { name: 'id', value: { kind: 'field', nodeId: 'comments', field: 'id' } },
        { name: 'created', value: { kind: 'field', nodeId: 'comments', field: 'created' } },
        { name: 'body', value: { kind: 'field', nodeId: 'comments', field: 'body' } },
      ] } } },
      { name: 'notificationState', value: { kind: 'object', nodeId: 'notificationState', object: { scopeNodeId: 'issueRoot', fields: [
        { name: 'subscribed', value: { kind: 'field', nodeId: 'notificationState', field: 'subscribed' } },
      ] } } },
      { name: 'viewState', value: { kind: 'object', nodeId: 'viewState', object: { scopeNodeId: 'issueRoot', fields: [
        { name: 'viewed', value: { kind: 'field', nodeId: 'viewState', field: 'viewed' } },
      ] } } },
    ] },
  },
  args: { sourceIssueID: graph.v.string({ maxBytes: 128 }) },
  bounds: {
    maxScannedRows: 1_067, maxIndexRanges: 26, maxResultRows: 1,
    maxResultBytes: 8_388_608, maxEvaluationTurnMs: 1_000, maxObservers: 1_024,
    maxDistinctEvaluationGroups: 1_024, maxEstimatedLiveFanoutMs: 5_000,
  },
  queryCost: { graph: {
    nodes: [
      { nodeId: 'issueRoot', maxRootRowsPerPage: 1, maxExaminedEntriesPerExecution: 2, maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 1_067, maxWindowResultRows: 1, maxWindowResultBytes: 8_388_608, maxWindowIndexRanges: 26 },
      { nodeId: 'assignee', maxExaminedEntriesPerExecution: 1, maxRelationshipLookupsPerExecution: 1 },
      { nodeId: 'comments', maxExaminedEntriesPerExecution: 1_025, maxRelationshipLookupsPerExecution: 1, maxChildrenPerParent: 1_024, maxWindowPages: 21, maxWindowRootRows: 0, maxWindowScannedRows: 21_525, maxWindowResultRows: 21, maxWindowResultBytes: 176_160_768, maxWindowIndexRanges: 21 },
      { nodeId: 'creator', maxExaminedEntriesPerExecution: 1, maxRelationshipLookupsPerExecution: 1 },
      { nodeId: 'labelEdges', maxExaminedEntriesPerExecution: 17, maxRelationshipLookupsPerExecution: 1, maxChildrenPerParent: 16 },
      { nodeId: 'labelRow', maxExaminedEntriesPerExecution: 16, maxRelationshipLookupsPerExecution: 16 },
      { nodeId: 'notificationState', maxExaminedEntriesPerExecution: 2, maxRelationshipLookupsPerExecution: 2 },
      { nodeId: 'project', maxExaminedEntriesPerExecution: 1, maxRelationshipLookupsPerExecution: 1 },
      { nodeId: 'viewState', maxExaminedEntriesPerExecution: 2, maxRelationshipLookupsPerExecution: 2 },
    ],
    arguments: [], maxArgumentItems: 1, maxPageResultBytes: 8_388_608,
    windowRollup: { maxWindowPages: 22, maxWindowRootRows: 1, maxWindowScannedRows: 22_592, maxWindowResultRows: 22, maxWindowResultBytes: 184_549_376, maxWindowIndexRanges: 47 },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: { classification: 'query-shaped' },
});

export const listIssueByID = graph.defineGraphQuery({
  nodes: [
    { nodeId: 'pointRoot', kind: 'root-window', edgeName: '$root', authorityClass: 1, table: issueListRead, filters: [{ field: 'sourceIssueID', op: 'Eq', value: graph.arg('sourceIssueID') }], accessIndex: 'by_source_issue_id', order: [graph.asc('sourceIssueID')] },
    { nodeId: 'issueRow', kind: 'equality-to-one', edgeName: 'issue', authorityClass: 1, parentNodeId: 'pointRoot', table: issue, joinOn: [{ rootField: 'issueID', joinedField: '_id' }], accessIndex: 'by_id', presence: 'required' },
    { nodeId: 'labelEdges', kind: 'bounded-to-many', edgeName: 'labels', authorityClass: 1, parentNodeId: 'pointRoot', table: issueLabelRead, joinOn: [{ rootField: 'issueID', joinedField: 'issueID' }], accessIndex: 'by_issue_label', order: [graph.asc('labelID')], page: { kind: 'literal', direction: 'forward', lower: { kind: 'unbounded' }, upper: { kind: 'unbounded' }, take: 16 } },
    { nodeId: 'labelRow', kind: 'equality-to-one', edgeName: 'label', authorityClass: 1, parentNodeId: 'labelEdges', table: label, joinOn: [{ rootField: 'labelID', joinedField: '_id' }], accessIndex: 'by_id', presence: 'required' },
    { nodeId: 'selectedLabels', kind: 'exists-semi-join', edgeName: 'selectedLabels', authorityClass: 1, parentNodeId: 'pointRoot', mode: 'all', edge: { kind: 'direct', table: issueLabelRead, joinOn: [{ rootField: 'issueID', joinedField: 'issueID' }], accessIndex: 'by_issue_label' }, filters: [{ field: 'labelID', op: 'In', value: graph.arg('selectedLabelIDs') }], argumentId: 'selectedLabelIDs' },
    { nodeId: 'viewState', kind: 'principal-bound', edgeName: 'viewState', authorityClass: 3, parentNodeId: 'pointRoot', table: viewState, parentJoin: [{ rootField: 'issueID', joinedField: 'issueID' }], principalField: 'userID', accessIndex: 'by_issue_user', binding: { table: identityBinding, principalField: 'principal', valueField: 'userID', uniqueIndex: 'by_principal' } },
  ],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 3,
    object: { scopeNodeId: 'pointRoot', fields: [
      { name: 'issue', value: { kind: 'object', nodeId: 'issueRow', object: { scopeNodeId: 'pointRoot', fields: [
        { name: 'id', value: { kind: 'field', nodeId: 'issueRow', field: 'id' } },
        { name: 'shortID', value: { kind: 'field', nodeId: 'issueRow', field: 'shortID' } },
        { name: 'title', value: { kind: 'field', nodeId: 'issueRow', field: 'title' } },
        { name: 'open', value: { kind: 'field', nodeId: 'issueRow', field: 'open' } },
        { name: 'modified', value: { kind: 'field', nodeId: 'issueRow', field: 'modified' } },
        { name: 'created', value: { kind: 'field', nodeId: 'issueRow', field: 'created' } },
        { name: 'description', value: { kind: 'field', nodeId: 'issueRow', field: 'description' } },
      ] } } },
      { name: 'labels', value: { kind: 'array', scopeNodeId: 'labelEdges', item: { scopeNodeId: 'labelEdges', fields: [
        { name: 'label', value: { kind: 'object', nodeId: 'labelRow', object: { scopeNodeId: 'labelEdges', fields: [
          { name: 'id', value: { kind: 'field', nodeId: 'labelRow', field: 'id' } },
          { name: 'name', value: { kind: 'field', nodeId: 'labelRow', field: 'name' } },
        ] } } },
      ] } } },
      { name: 'viewState', value: { kind: 'object', nodeId: 'viewState', object: { scopeNodeId: 'pointRoot', fields: [
        { name: 'viewed', value: { kind: 'field', nodeId: 'viewState', field: 'viewed' } },
      ] } } },
    ] },
  },
  args: {
    sourceIssueID: graph.v.string({ maxBytes: 128 }),
    selectedLabelIDs: graph.v.array(graph.v.string({ maxBytes: 128 }), { maxItems: 16 }),
  },
  bounds: {
    maxScannedRows: 54, maxIndexRanges: 37, maxResultRows: 1,
    maxResultBytes: 1_048_576, maxEvaluationTurnMs: 1_000, maxObservers: 1_024,
    maxDistinctEvaluationGroups: 1_024, maxEstimatedLiveFanoutMs: 5_000,
  },
  queryCost: { graph: {
    nodes: [
      { nodeId: 'pointRoot', maxRootRowsPerPage: 1, maxExaminedEntriesPerExecution: 2, maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 54, maxWindowResultRows: 1, maxWindowResultBytes: 1_048_576, maxWindowIndexRanges: 37 },
      { nodeId: 'issueRow', maxExaminedEntriesPerExecution: 1, maxRelationshipLookupsPerExecution: 1 },
      { nodeId: 'labelEdges', maxExaminedEntriesPerExecution: 17, maxRelationshipLookupsPerExecution: 1, maxChildrenPerParent: 16 },
      { nodeId: 'labelRow', maxExaminedEntriesPerExecution: 16, maxRelationshipLookupsPerExecution: 16 },
      { nodeId: 'selectedLabels', maxExaminedEntriesPerExecution: 16, maxRelationshipLookupsPerExecution: 16, maxChildrenPerParent: 1, maxArgumentExpansion: 16 },
      { nodeId: 'viewState', maxExaminedEntriesPerExecution: 2, maxRelationshipLookupsPerExecution: 2 },
    ],
    arguments: [{ argumentId: 'selectedLabelIDs', maxItems: 16 }],
    maxArgumentItems: 17, maxPageResultBytes: 1_048_576,
    windowRollup: { maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 54, maxWindowResultRows: 1, maxWindowResultBytes: 1_048_576, maxWindowIndexRanges: 37 },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: { classification: 'query-shaped' },
});
