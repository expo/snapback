import * as graphDsl from '@expo/snapback-codegen/define';
import { membershipResource } from '@expo/snapback-codegen/define';
import { roomMembers, rooms } from './schema.mjs';

// Keep each declaration as one syntactic literal tree: the B2 source walk is
// itself the separation proof and admits no referenced authoring fragments.
// @ref LLP 0209#33-the-nine-llp-0268-inputs-and-their-carriers — the predicate can occur only at the
// establishment allow/deny position in this source carrier.
export const publicRooms = graphDsl.defineGraphQuery({
  nodes: [{
    nodeId: 'rooms', kind: 'root-window', edgeName: '$root', authorityClass: 1,
    table: rooms,
    filters: [graphDsl.eq('scopeId', graphDsl.arg('roomId'))],
    accessIndex: 'by_scope_updated', order: [graphDsl.desc('updatedAt')],
  }],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 1,
    object: {
      scopeNodeId: 'rooms',
      fields: [
        { name: 'scopeId', value: { kind: 'field', nodeId: 'rooms', field: 'scopeId' } },
        { name: 'name', value: { kind: 'field', nodeId: 'rooms', field: 'name' } },
      ],
    },
  },
  args: { roomId: graphDsl.v.id('rooms') },
  membership: [roomMembers.hasRole(membershipResource.arg('roomId'), 'member')],
  bounds: {
    maxScannedRows: 3, maxIndexRanges: 1, maxResultRows: 2, maxResultBytes: 512,
    maxEvaluationTurnMs: 10, maxObservers: 8, maxDistinctEvaluationGroups: 4,
    maxEstimatedLiveFanoutMs: 10,
  },
  queryCost: { graph: {
    nodes: [{
      nodeId: 'rooms', maxRootRowsPerPage: 2, maxExaminedEntriesPerExecution: 3,
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 1024, maxWindowIndexRanges: 2,
    }],
    arguments: [], maxArgumentItems: 1, maxPageResultBytes: 512,
    windowRollup: {
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 1024, maxWindowIndexRanges: 2,
    },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: {
    classification: 'broadcast',
    establishment: { predicate: {
      kind: 'membership', declaration: 'roomMembers', resourceField: 'scopeId',
      roles: ['member'],
    } },
  },
});

// The same establishment request without a resource-to-argument equality is
// the compiler's fail-closed scopeMismatch carrier.
export const publicRoomsUnbound = graphDsl.defineGraphQuery({
  nodes: [{
    nodeId: 'rooms', kind: 'root-window', edgeName: '$root', authorityClass: 1,
    table: rooms,
    filters: [graphDsl.eq('category', graphDsl.literal('public'))],
    accessIndex: 'by_category_updated', order: [graphDsl.desc('updatedAt')],
  }],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 1,
    object: {
      scopeNodeId: 'rooms',
      fields: [
        { name: 'scopeId', value: { kind: 'field', nodeId: 'rooms', field: 'scopeId' } },
        { name: 'name', value: { kind: 'field', nodeId: 'rooms', field: 'name' } },
      ],
    },
  },
  args: { roomId: graphDsl.v.id('rooms') },
  membership: [roomMembers.hasRole(membershipResource.arg('roomId'), 'member')],
  bounds: {
    maxScannedRows: 3, maxIndexRanges: 1, maxResultRows: 2, maxResultBytes: 512,
    maxEvaluationTurnMs: 10, maxObservers: 8, maxDistinctEvaluationGroups: 4,
    maxEstimatedLiveFanoutMs: 10,
  },
  queryCost: { graph: {
    nodes: [{
      nodeId: 'rooms', maxRootRowsPerPage: 2, maxExaminedEntriesPerExecution: 3,
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 1024, maxWindowIndexRanges: 2,
    }],
    arguments: [], maxArgumentItems: 1, maxPageResultBytes: 512,
    windowRollup: {
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 1024, maxWindowIndexRanges: 2,
    },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: {
    classification: 'broadcast',
    establishment: { predicate: {
      kind: 'membership', declaration: 'roomMembers', resourceField: 'scopeId',
      roles: ['member'],
    } },
  },
});

// The establishment admits room members, but the function's strict delivery
// gate requires a distinct role. The compiler must keep this query-shaped as
// the executable audience-parity-failed divergence witness.
export const publicRoomsDivergent = graphDsl.defineGraphQuery({
  nodes: [{
    nodeId: 'rooms', kind: 'root-window', edgeName: '$root', authorityClass: 1,
    table: rooms,
    filters: [graphDsl.eq('scopeId', graphDsl.arg('roomId'))],
    accessIndex: 'by_scope_updated', order: [graphDsl.desc('updatedAt')],
  }],
  projection: {
    nodeId: 'result', edgeName: '$result', authorityClass: 1,
    object: {
      scopeNodeId: 'rooms',
      fields: [
        { name: 'scopeId', value: { kind: 'field', nodeId: 'rooms', field: 'scopeId' } },
        { name: 'name', value: { kind: 'field', nodeId: 'rooms', field: 'name' } },
      ],
    },
  },
  args: { roomId: graphDsl.v.id('rooms') },
  membership: [roomMembers.hasRole(membershipResource.arg('roomId'), 'moderator')],
  bounds: {
    maxScannedRows: 3, maxIndexRanges: 1, maxResultRows: 2, maxResultBytes: 512,
    maxEvaluationTurnMs: 10, maxObservers: 8, maxDistinctEvaluationGroups: 4,
    maxEstimatedLiveFanoutMs: 10,
  },
  queryCost: { graph: {
    nodes: [{
      nodeId: 'rooms', maxRootRowsPerPage: 2, maxExaminedEntriesPerExecution: 3,
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 1024, maxWindowIndexRanges: 2,
    }],
    arguments: [], maxArgumentItems: 1, maxPageResultBytes: 512,
    windowRollup: {
      maxWindowPages: 2, maxWindowRootRows: 4, maxWindowScannedRows: 6,
      maxWindowResultRows: 4, maxWindowResultBytes: 1024, maxWindowIndexRanges: 2,
    },
    maxMaintainedWritesPerMutation: 0,
  } },
  broadcast: {
    classification: 'broadcast',
    establishment: { predicate: {
      kind: 'membership', declaration: 'roomMembers', resourceField: 'scopeId',
      roles: ['member'],
    } },
  },
});
