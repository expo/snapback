// LLP 0102 Linear deep-round model.
//
// @ref LLP 0056#invalidation-the-llp-0053-mapping — organization membership
// is authorization backing for every issue-tracker read and write.

import { defineSchema, defineTable, v } from '../../../../../../_kit/define.mjs';

export const organizationMembers = defineTable({
  organizationId: v.id('organizations'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'organizationMembers',
  principal: 'userId',
  resource: 'organizationId',
  role: 'role',
  roles: ['owner', 'member'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
  ],
});

export default defineSchema({
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.principal(),
  }).sync(),
  organizationMembers,
  teams: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    key: v.string(),
  }).index('by_organization_key', ['organizationId', 'key']).sync(),
  projects: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    state: v.string(),
  }).index('by_organization_name', ['organizationId', 'name']).sync(),
  labels: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    color: v.string(),
  }).index('by_organization_name', ['organizationId', 'name']).sync(),
  issues: defineTable({
    organizationId: v.id('organizations'),
    teamId: v.id('teams'),
    projectId: v.id('projects'),
    assigneeId: v.principal(),
    identifier: v.string(),
    sequence: v.integer(),
    title: v.string(),
    description: v.string(),
    status: v.string(),
    priority: v.integer(),
    boardPosition: v.integer(),
  })
    .index('by_organization_sequence', ['organizationId', 'sequence'])
    .index('by_organization_status', ['organizationId', 'status', 'sequence'])
    .index('by_organization_assignee', ['organizationId', 'assigneeId', 'sequence'])
    .index('by_organization_project', ['organizationId', 'projectId', 'sequence'])
    .sync(),
  issueLabels: defineTable({
    organizationId: v.id('organizations'),
    issueId: v.id('issues'),
    labelId: v.id('labels'),
  })
    .index('by_issue_label', ['issueId', 'labelId'])
    .index('by_label_issue', ['labelId', 'issueId'])
    .sync(),
  comments: defineTable({
    organizationId: v.id('organizations'),
    issueId: v.id('issues'),
    authorId: v.principal(),
    sequence: v.integer(),
    body: v.string(),
  }).index('by_issue_sequence', ['issueId', 'sequence']).sync(),
  activities: defineTable({
    organizationId: v.id('organizations'),
    issueId: v.id('issues'),
    actorId: v.principal(),
    sequence: v.integer(),
    kind: v.string(),
    body: v.string(),
  }).index('by_issue_sequence', ['issueId', 'sequence']).sync(),
}, { auth: { mode: 'sessions' } });
