import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A3 collaborative issue and planning board (contract
// a3-issue-board.v1). Sessions mode: the server derives identity. The
// organization is seeded literally (versioned seed) and membership seats are
// claimed through seeded invite rows: the guide's documented pattern of
// "app-data invitations plus a self transition" — redeemInvite is the only
// mutation that calls the by:['none'] self-insert, and it requires an
// unconsumed invite code from the fixture.
export const orgMembers = defineTable({
  orgId: v.id('organizations'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'orgMembers',
  principal: 'userId',
  resource: 'orgId',
  role: 'role',
  roles: ['owner', 'member', 'guest'],
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['owner', 'member', 'guest'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['owner', 'member', 'guest'] },
  ],
});

// Exported so functions.mjs can bind the search query and keyset pages to
// the table object (defineSearchQuery / defineOwnedKeysetPages take table
// references, not names).
export const issues = defineTable({
  orgId: v.id('organizations'),
  teamId: v.id('teams'),
  projectId: v.id('projects'),
  identifier: v.string(), // 'ISS-142'
  title: v.string(),
  description: v.string(),
  status: v.string(), // 'todo' | 'in-progress' | 'review' | 'done'
  priority: v.integer(), // 0 (none) .. 4 (urgent)
  // Required principal so owner-partitioned search and keyset pagination
  // stay declarable; seeded rows carry a placeholder principal that matches
  // no session, runtime assignment patches in real server-minted ids.
  assigneeId: v.principal(),
  assigneeName: v.string(),
  boardPosition: v.integer(),
  revision: v.integer(),
  commentSeq: v.integer(),
  activitySeq: v.integer(),
  pageKey: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_org', ['orgId'])
  .index('by_org_identifier', ['orgId', 'identifier'], { unique: true })
  .index('by_org_page_key', ['orgId', 'pageKey'], { unique: true })
  .index('by_assignee_page_key', ['assigneeId', 'pageKey'], { unique: true })
  .index('by_org_status_position', ['orgId', 'status', 'boardPosition'])
  .index('by_org_updated', ['orgId', 'updatedAt'])
  .index('by_project', ['projectId'])
  .searchIndex('search_issues', {
    semanticVersion: 'a3-board-issues.v1',
    textFields: {
      title: { weight: 8, classification: 'public' },
      description: { weight: 4, classification: 'public' },
      identifier: { weight: 2, classification: 'public' },
    },
    fieldClassifications: {
      assigneeId: 'public',
      status: 'public',
      priority: 'public',
      updatedAt: 'public',
    },
    equalityFilters: ['status'],
    storedFields: ['identifier', 'title', 'status', 'priority', 'updatedAt'],
    highlightFields: ['title', 'description'],
    // v1 search visibility is owner-or-public only (membership partitions
    // are not accepted), so the ordinary supported path here is the
    // assignee's own partition: "search my issues".
    visibility: { kind: 'owner', field: 'assigneeId' },
  })
  .sync();

const schema = defineSchema({
  organizations: defineTable({
    name: v.string(),
    // Human-visible issue sequence: createIssue allocates ISS-<n> from this
    // counter inside the mutation transaction (Linear-shaped identifiers).
    nextIssueNumber: v.integer(),
  })
    .index('by_name', ['name'], { unique: true })
    .sync(),

  teams: defineTable({
    orgId: v.id('organizations'),
    key: v.string(),
    name: v.string(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_key', ['orgId', 'key'], { unique: true })
    .sync(),

  projects: defineTable({
    orgId: v.id('organizations'),
    teamId: v.id('teams'),
    name: v.string(),
    status: v.string(), // 'active' | 'paused'
  })
    .index('by_org', ['orgId'])
    .index('by_team', ['teamId'])
    .sync(),

  issues,

  labels: defineTable({
    orgId: v.id('organizations'),
    name: v.string(),
    color: v.string(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_name', ['orgId', 'name'], { unique: true })
    .sync(),

  issueLabels: defineTable({
    orgId: v.id('organizations'),
    issueId: v.id('issues'),
    labelId: v.id('labels'),
  })
    .index('by_issue', ['issueId'])
    .index('by_issue_label', ['issueId', 'labelId'], { unique: true })
    .sync(),

  comments: defineTable({
    orgId: v.id('organizations'),
    issueId: v.id('issues'),
    authorId: v.optional(v.principal()),
    authorName: v.string(),
    body: v.string(),
    seq: v.integer(),
    clientKey: v.string(),
    createdAt: v.integer(),
  })
    .index('by_issue_seq', ['issueId', 'seq'], { unique: true })
    .index('by_issue_client_key', ['issueId', 'clientKey'], { unique: true })
    .sync(),

  activity: defineTable({
    orgId: v.id('organizations'),
    issueId: v.id('issues'),
    actorId: v.optional(v.principal()),
    actorName: v.string(),
    kind: v.string(), // 'created' | 'status' | 'assignee' | 'priority' | 'moved' | 'commented' | 'labeled'
    detail: v.string(),
    seq: v.integer(),
    createdAt: v.integer(),
  })
    .index('by_issue_seq', ['issueId', 'seq'], { unique: true })
    .index('by_org_created', ['orgId', 'createdAt'])
    .sync(),

  orgInvites: defineTable({
    orgId: v.id('organizations'),
    email: v.string(),
    role: v.string(),
    code: v.string(),
    consumed: v.boolean(),
  })
    .index('by_code', ['code'], { unique: true })
    .sync(),

  orgMembers,
}, {
  auth: { mode: 'sessions' },
});

export default schema;
