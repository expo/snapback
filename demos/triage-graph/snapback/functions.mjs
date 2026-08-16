// Fresh provider-native Triage transforms. Nothing here is copied from the
// predecessor workload: the screen is expressed as one generated snapshot
// batch and one independently generated retained relational result.

import {
  asc,
  defineBoundedChildrenQuery,
  defineJsMutation,
  defineJsQuery,
  defineRelationalQuery,
  defineSnapshotBatchQuery,
  owner,
  results,
  throughParent,
  v,
} from '@expo/snapback-codegen/define';
import {
  activeIssues,
  projectDirectory,
  transitionSummaries,
  triageBoards,
} from './schema.mjs';

export const activeIssuePage = defineBoundedChildrenQuery({
  parent: {
    table: triageBoards,
    idArg: 'boardId',
    visibility: owner('ownerId'),
    select: { name: 'name', workloadRevision: 'workloadRevision' },
  },
  children: {
    table: activeIssues,
    foreignKey: 'boardId',
    parentIncarnation: 'boardIncarnation',
    visibility: throughParent(),
    index: 'by_board_rank',
    order: [asc('rank')],
    select: {
      id: '_id',
      issueKey: 'issueKey',
      projectKey: 'projectKey',
      title: 'title',
      state: 'state',
      priority: 'priority',
      rank: 'rank',
    },
  },
  take: 50,
  parentDeletion: 'hide-orphans.v1',
});

export const transitionPage = defineBoundedChildrenQuery({
  parent: {
    table: triageBoards,
    idArg: 'boardId',
    visibility: owner('ownerId'),
    select: { name: 'name', workloadRevision: 'workloadRevision' },
  },
  children: {
    table: transitionSummaries,
    foreignKey: 'boardId',
    parentIncarnation: 'boardIncarnation',
    visibility: throughParent(),
    index: 'by_board_sequence',
    order: [asc('sequence')],
    select: {
      id: '_id',
      issueKey: 'issueKey',
      sequence: 'sequence',
      summary: 'summary',
    },
  },
  take: 20,
  parentDeletion: 'hide-orphans.v1',
});

// @ref LLP 0135#21-composite-plan-shape — declaration order is the tuple
// order consumed directly by the Triage screen; the continuation is sbsb1.
// @ref LLP 0157#move-1-workload-exit-llp-0155-normative-transcription — this
// generated composite replaces predecessor JavaScript collection joins.
export const triageGraph = defineSnapshotBatchQuery({
  nodes: [activeIssuePage, transitionPage],
});

// @ref LLP 0166#d4--completeness-honest-local-answers — the closed
// owner-scoped relational profile is the only Triage result rendered as
// authoritative-retained after restart; triageGraph itself remains volatile.
export const retainedInbox = defineRelationalQuery({
  root: activeIssues,
  joined: projectDirectory,
  join: [
    { root: 'ownerId', joined: 'ownerId' },
    { root: 'projectKey', joined: 'projectKey' },
  ],
  kind: 'inner',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'owner', field: 'ownerId' },
    output: 'owner',
  },
  projection: {
    issueKey: { root: 'issueKey' },
    title: { root: 'title' },
    state: { root: 'state' },
    priority: { root: 'priority' },
    rank: { root: 'rank' },
    projectKey: { root: 'projectKey' },
    projectName: { joined: 'projectName' },
  },
  take: 100,
  rootIndex: 'by_owner_rank',
  joinedIndex: 'by_owner_project',
  retention: 'opaque-authorized-snapshot-v1',
});

async function ownedBoard(ctx, boardId) {
  const board = await ctx.db.get('triageBoards', boardId);
  if (!board || board.ownerId !== ctx.auth.userId) {
    const error = new Error('board not found');
    error.code = 'SNAPBACK_ROW_NOT_FOUND';
    throw error;
  }
  return board;
}

export const createBoard = defineJsMutation({
  auth: 'authenticated',
  args: {
    name: v.string(),
    projectKey: v.string(),
    projectName: v.string(),
  },
  reads: ['projectDirectory'],
  writes: ['triageBoards', 'projectDirectory'],
  result: results.value(v.id('triageBoards')),
  handler: async (ctx, args) => {
    const ownerId = ctx.auth.userId;
    const existing = await ctx.db.query('projectDirectory')
      .withIndex('by_owner_project')
      .eq('ownerId', ownerId)
      .eq('projectKey', args.projectKey)
      .first();
    if (!existing) {
      await ctx.db.insert('projectDirectory', {
        projectKey: args.projectKey,
        projectName: args.projectName,
      });
    }
    return ctx.db.insert('triageBoards', {
      name: args.name,
      workloadRevision: 1,
    });
  },
});

const eventInput = v.object({
  issueKey: v.string(),
  sequence: v.integer(),
});

export const appendBaselineEvents = defineJsMutation({
  auth: 'authenticated',
  args: {
    boardId: v.id('triageBoards'),
    events: v.array(eventInput, { maxItems: 1000 }),
  },
  reads: ['triageBoards'],
  writes: ['triageEvents'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ownedBoard(ctx, args.boardId);
    for (const event of args.events) {
      await ctx.db.insert('triageEvents', {
        boardId: args.boardId,
        issueKey: event.issueKey,
        sequence: event.sequence,
        kind: 'baseline',
      });
    }
    return args.events.length;
  },
});

const burstInput = v.object({
  issueKey: v.string(),
  sequence: v.integer(),
  activeRank: v.optional(v.integer()),
  title: v.string(),
});

export const applyUpdateBurst = defineJsMutation({
  auth: 'authenticated',
  args: {
    boardId: v.id('triageBoards'),
    updates: v.array(burstInput, { maxItems: 100 }),
  },
  reads: ['triageBoards'],
  writes: ['triageEvents', 'activeIssues', 'transitionSummaries'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ownedBoard(ctx, args.boardId);
    for (const update of args.updates) {
      await ctx.db.insert('triageEvents', {
        boardId: args.boardId,
        issueKey: update.issueKey,
        sequence: update.sequence,
        kind: 'update',
      });
      if (update.activeRank !== null && update.activeRank !== undefined) {
        await ctx.db.insert('activeIssues', {
          boardId: args.boardId,
          issueKey: update.issueKey,
          projectKey: 'P3',
          title: update.title,
          state: 'active',
          priority: update.activeRank % 4,
          rank: update.activeRank,
        });
      }
      if (update.sequence >= 249980) {
        await ctx.db.insert('transitionSummaries', {
          boardId: args.boardId,
          issueKey: update.issueKey,
          sequence: update.sequence,
          summary: `update ${update.sequence} evaluated`,
        });
      }
    }
    return args.updates.length;
  },
});

export const seedSwitchIssue = defineJsMutation({
  auth: 'authenticated',
  args: {
    boardId: v.id('triageBoards'),
    ordinal: v.integer(),
  },
  reads: ['triageBoards'],
  writes: ['activeIssues'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ownedBoard(ctx, args.boardId);
    await ctx.db.insert('activeIssues', {
      boardId: args.boardId,
      issueKey: `SWITCH-${args.ordinal}`,
      projectKey: 'P3',
      title: `query switch ${args.ordinal}`,
      state: 'active',
      priority: 0,
      rank: 1000 + args.ordinal,
    });
    return true;
  },
});

// Acceptance-only refusal probe. It deliberately has no explicit bound; at
// 1024 rows the runtime refuses instead of returning an ambiguous prefix.
export const implicitPrefixProbe = defineJsQuery({
  auth: 'authenticated',
  args: { boardId: v.id('triageBoards') },
  reads: ['triageBoards', 'triageEvents'],
  result: results.records(v.object({ issueKey: v.string(), sequence: v.integer() })),
  handler: async (ctx, args) => {
    await ownedBoard(ctx, args.boardId);
    const events = await ctx.db.query('triageEvents')
      .withIndex('by_board_sequence')
      .eq('boardId', args.boardId)
      .collect();
    return events.map(({ issueKey, sequence }) => ({ issueKey, sequence }));
  },
});
