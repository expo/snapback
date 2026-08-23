import * as graphDsl from '@expo/snapback-codegen/define';
import { issues } from './schema.mjs';

export const issueGraph = graphDsl.defineGraphQuery({
  nodes: [{
    nodeId: 'root',
    kind: 'root-window',
    edgeName: '$root',
    authorityClass: 2,
    table: issues,
    filters: [],
    accessIndex: 'by_updated',
    order: [graphDsl.desc('updatedAt')],
  }],
  projection: {
    nodeId: 'result',
    edgeName: '$result',
    authorityClass: 2,
    object: {
      scopeNodeId: 'root',
      fields: [{
        name: 'title',
        value: { kind: 'field', nodeId: 'root', field: 'title' },
      }],
    },
  },
  args: {
    labels: graphDsl.v.array(graphDsl.v.string({ maxBytes: 32 }), { maxItems: 3 }),
    assignees: graphDsl.v.array(graphDsl.v.string({ maxBytes: 32 }), { maxItems: 5 }),
  },
  bounds: {
    maxScannedRows: 3,
    maxIndexRanges: 1,
    maxResultRows: 2,
    maxResultBytes: 100,
    maxEvaluationTurnMs: 10,
    maxObservers: 1,
    maxDistinctEvaluationGroups: 1,
    maxEstimatedLiveFanoutMs: 10,
  },
  queryCost: {
    graph: {
      nodes: [{
        nodeId: 'root',
        maxRootRowsPerPage: 2,
        maxExaminedEntriesPerExecution: 3,
        maxWindowPages: 2,
        maxWindowRootRows: 4,
        maxWindowScannedRows: 6,
        maxWindowResultRows: 4,
        maxWindowResultBytes: 200,
        maxWindowIndexRanges: 2,
      }],
      arguments: [
        { argumentId: 'labels', maxItems: 3 },
        { argumentId: 'assignees', maxItems: 5 },
      ],
      maxArgumentItems: 8,
      maxPageResultBytes: 100,
      windowRollup: {
        maxWindowPages: 2,
        maxWindowRootRows: 4,
        maxWindowScannedRows: 6,
        maxWindowResultRows: 4,
        maxWindowResultBytes: 200,
        maxWindowIndexRanges: 2,
      },
      maxMaintainedWritesPerMutation: 0,
    },
  },
  broadcast: { classification: 'query-shaped' },
});
