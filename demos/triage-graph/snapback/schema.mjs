// Fresh Move-1 Triage successor storage. The graph screen is parent-scoped;
// the retained inbox duplicates only the owner key needed by the closed
// relational retention profile.
//
// @ref LLP 0157#move-1-workload-exit-llp-0155-normative-transcription — the
// successor needs bounded children, stable pagination, and source-level owner
// protection rather than client-side collection joins.
// @ref LLP 0166#d4--completeness-honest-local-answers — only the
// lease-authorized relational result is eligible for authoritative relaunch.

import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const triageBoards = defineTable({
  ownerId: v.principal(),
  name: v.string(),
  workloadRevision: v.integer(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_owner_name', ['ownerId', 'name'])
  .sync();

export const projectDirectory = defineTable({
  ownerId: v.principal(),
  projectKey: v.string(),
  projectName: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_owner_project', ['ownerId', 'projectKey'], { unique: true })
  .sync();

export const activeIssues = defineTable({
  boardId: v.id('triageBoards'),
  boardIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'boardId',
    parentTable: 'triageBoards',
  }),
  ownerId: v.principal(),
  issueKey: v.string(),
  projectKey: v.string(),
  title: v.string(),
  state: v.string(),
  priority: v.integer(),
  rank: v.integer(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_board_rank', ['boardId', 'boardIncarnation', 'rank'])
  .index('by_owner_rank', ['ownerId', 'rank'])
  .sync();

export const transitionSummaries = defineTable({
  boardId: v.id('triageBoards'),
  boardIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'boardId',
    parentTable: 'triageBoards',
  }),
  ownerId: v.principal(),
  issueKey: v.string(),
  sequence: v.integer(),
  summary: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_board_sequence', ['boardId', 'boardIncarnation', 'sequence'])
  .sync();

// The 250,000-row acceptance source stays server-side. It participates in
// the owner-checked mutations and implicit-prefix refusal, but is never part
// of the client sync set.
export const triageEvents = defineTable({
  boardId: v.id('triageBoards'),
  boardIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'boardId',
    parentTable: 'triageBoards',
  }),
  ownerId: v.principal(),
  issueKey: v.string(),
  sequence: v.integer(),
  kind: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_board_sequence', ['boardId', 'boardIncarnation', 'sequence']);

export default defineSchema({
  triageBoards,
  projectDirectory,
  activeIssues,
  transitionSummaries,
  triageEvents,
}, { auth: { mode: 'sessions' } });
