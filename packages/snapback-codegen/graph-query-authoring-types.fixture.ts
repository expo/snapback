import {
  defineGraphQuery,
  defineSchema,
  defineTable,
  desc,
  v,
} from './define.js';

const issues = defineTable({ title: v.string(), updatedAt: v.integer() })
  .index('by_updated', ['updatedAt'])
  .visibility({ kind: 'public-read' });
defineSchema({ issues });

defineGraphQuery({
  nodes: [{
    nodeId: 'root',
    kind: 'root-window',
    edgeName: '$root',
    authorityClass: 1,
    table: issues,
    filters: [],
    accessIndex: 'by_updated',
    order: [desc('updatedAt')],
  }],
  projection: {
    nodeId: 'result',
    edgeName: '$result',
    authorityClass: 1,
    object: {
      scopeNodeId: 'root',
      fields: [{
        name: 'title',
        value: { kind: 'field', nodeId: 'root', field: 'title' },
      }],
    },
  },
  args: {},
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
  queryCost: { graph: {
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
    arguments: [],
    maxArgumentItems: 0,
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
  } },
  broadcast: { classification: 'query-shaped' },
});

defineGraphQuery({
  // @ts-expect-error graph nodes are a closed tagged union
  nodes: [{ nodeId: 'x', kind: 'recursive', edgeName: 'x', authorityClass: 1 }],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 1,
    object: { scopeNodeId: 'x', fields: [] },
  },
  args: {},
  bounds: {
    maxScannedRows: 1, maxIndexRanges: 1, maxResultRows: 1, maxResultBytes: 1,
    maxEvaluationTurnMs: 1, maxObservers: 1, maxDistinctEvaluationGroups: 1,
    maxEstimatedLiveFanoutMs: 1,
  },
  queryCost: { graph: {
    nodes: [], arguments: [], maxArgumentItems: 0, maxPageResultBytes: 1,
    windowRollup: {
      maxWindowPages: 0, maxWindowRootRows: 0, maxWindowScannedRows: 0,
      maxWindowResultRows: 0, maxWindowResultBytes: 0, maxWindowIndexRanges: 0,
    },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: { classification: 'query-shaped' },
});
