import { i } from '@instantdb/core';

const schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    organizations: i.entity({
      name: i.string(),
      slug: i.string().unique().indexed(),
      ownerId: i.string().indexed(),
    }),
    memberships: i.entity({
      key: i.string().unique().indexed(),
      userId: i.string().indexed(),
      role: i.string().indexed(),
    }),
    teams: i.entity({
      key: i.string().unique().indexed(),
      name: i.string(),
      orgId: i.string().indexed(),
    }),
    projects: i.entity({
      key: i.string().unique().indexed(),
      name: i.string(),
      orgId: i.string().indexed(),
    }),
    labels: i.entity({
      key: i.string().unique().indexed(),
      name: i.string().indexed(),
      color: i.string(),
      orgId: i.string().indexed(),
    }),
    issues: i.entity({
      issueNumber: i.number().unique().indexed(),
      title: i.string().indexed(),
      description: i.string(),
      status: i.string().indexed(),
      priority: i.string().indexed(),
      assigneeId: i.string().indexed().optional(),
      orgId: i.string().indexed(),
      teamId: i.string().indexed(),
      projectId: i.string().indexed(),
      boardPosition: i.number().indexed(),
      revision: i.number(),
      moveNonce: i.string().indexed(),
      createdOrder: i.number().unique().indexed(),
      updatedAt: i.date().indexed(),
    }),
    comments: i.entity({
      authorId: i.string().indexed(),
      body: i.string(),
      clientNonce: i.string().unique().indexed(),
      createdOrder: i.number().unique().indexed(),
      createdAt: i.date().indexed(),
    }),
    activities: i.entity({
      actorId: i.string().indexed(),
      kind: i.string().indexed(),
      detail: i.string(),
      clientNonce: i.string().unique().indexed(),
      createdOrder: i.number().unique().indexed(),
      createdAt: i.date().indexed(),
    }),
  },
  links: {
    membershipUser: {
      forward: { on: 'memberships', has: 'one', label: 'user' },
      reverse: { on: '$users', has: 'many', label: 'memberships' },
    },
    organizationMemberships: {
      forward: { on: 'organizations', has: 'many', label: 'members' },
      reverse: { on: 'memberships', has: 'one', label: 'organization' },
    },
    organizationTeams: {
      forward: { on: 'organizations', has: 'many', label: 'teams' },
      reverse: { on: 'teams', has: 'one', label: 'organization' },
    },
    organizationProjects: {
      forward: { on: 'organizations', has: 'many', label: 'projects' },
      reverse: { on: 'projects', has: 'one', label: 'organization' },
    },
    organizationLabels: {
      forward: { on: 'organizations', has: 'many', label: 'labels' },
      reverse: { on: 'labels', has: 'one', label: 'organization' },
    },
    organizationIssues: {
      forward: { on: 'organizations', has: 'many', label: 'issues' },
      reverse: { on: 'issues', has: 'one', label: 'organization' },
    },
    teamIssues: {
      forward: { on: 'teams', has: 'many', label: 'issues' },
      reverse: { on: 'issues', has: 'one', label: 'team' },
    },
    projectIssues: {
      forward: { on: 'projects', has: 'many', label: 'issues' },
      reverse: { on: 'issues', has: 'one', label: 'project' },
    },
    issueAssignee: {
      forward: { on: 'issues', has: 'one', label: 'assignee' },
      reverse: { on: '$users', has: 'many', label: 'assignedIssues' },
    },
    issueLabels: {
      forward: { on: 'issues', has: 'many', label: 'labels' },
      reverse: { on: 'labels', has: 'many', label: 'issues' },
    },
    issueComments: {
      forward: { on: 'issues', has: 'many', label: 'comments' },
      reverse: { on: 'comments', has: 'one', label: 'issue' },
    },
    issueActivities: {
      forward: { on: 'issues', has: 'many', label: 'activities' },
      reverse: { on: 'activities', has: 'one', label: 'issue' },
    },
  },
});

export default schema;
