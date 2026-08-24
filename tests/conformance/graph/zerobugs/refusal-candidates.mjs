import * as graph from '@expo/snapback-codegen/define';
import { issueListRead } from './schema.mjs';

const base = {
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 1,
    object: { scopeNodeId: 'root', fields: [{ name: 'id', value: { kind: 'field', nodeId: 'root', field: 'sourceIssueID' } }] },
  },
  args: { projectID: graph.v.string({ maxBytes: 128 }), textFilter: graph.v.string({ maxBytes: 1_024 }) },
  bounds: { maxScannedRows: 2, maxIndexRanges: 1, maxResultRows: 1, maxResultBytes: 4_096, maxEvaluationTurnMs: 10, maxObservers: 1, maxDistinctEvaluationGroups: 1, maxEstimatedLiveFanoutMs: 10 },
  queryCost: { graph: {
    nodes: [{ nodeId: 'root', maxRootRowsPerPage: 1, maxExaminedEntriesPerExecution: 2, maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 2, maxWindowResultRows: 1, maxWindowResultBytes: 4_096, maxWindowIndexRanges: 1 }],
    arguments: [], maxArgumentItems: 2, maxPageResultBytes: 4_096,
    windowRollup: { maxWindowPages: 1, maxWindowRootRows: 1, maxWindowScannedRows: 2, maxWindowResultRows: 1, maxWindowResultBytes: 4_096, maxWindowIndexRanges: 1 },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: { classification: 'query-shaped' },
};

export function issueListSearchCandidate() {
  return graph.defineGraphQuery({
    ...base,
    nodes: [
      { nodeId: 'root', kind: 'root-window', edgeName: '$root', authorityClass: 1, table: issueListRead, filters: [{ field: 'projectID', op: 'Eq', value: graph.arg('projectID') }], accessIndex: 'by_project_modified', order: [graph.desc('modified')] },
      { nodeId: 'search', kind: 'search-membership', edgeName: 'search', authorityClass: 2, parentNodeId: 'root', providerCapabilityId: 'zerobugs-control-search-v1', membershipIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', memberField: 'sourceIssueID', scopeBindings: [], invalidationTables: [], providerCompletenessClass: 'exact', argumentIds: ['textFilter'] },
    ],
  });
}

function orderedThroughCandidate() {
  return graph.defineGraphQuery({
    ...base,
    nodes: [
      { nodeId: 'root', kind: 'root-window', edgeName: '$root', authorityClass: 1, table: issueListRead, filters: [{ field: 'projectID', op: 'Eq', value: graph.arg('projectID') }], accessIndex: 'by_project_modified', order: [graph.desc('modified')] },
      // Deliberately executable refusal: v1 has through edges only for
      // exists-semi-join, not a result-bearing bounded-through-many node that
      // could preserve the control's label.name order.
      { nodeId: 'labels', kind: 'bounded-through-many', edgeName: 'labels', authorityClass: 1, parentNodeId: 'root' },
    ],
  });
}

export const issueDetailOrderedLabelsCandidate = orderedThroughCandidate;
export const listIssueByIDOrderedLabelsCandidate = orderedThroughCandidate;
