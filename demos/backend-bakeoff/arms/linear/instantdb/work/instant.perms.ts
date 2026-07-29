import type { InstantRules } from '@instantdb/core';

const rules = {
  $users: {
    allow: {
      view:
        "auth.id != null && (auth.id == data.id || auth.id in data.ref('memberships.organization.members.userId'))",
      create: 'true',
      update:
        "auth.id != null && auth.id in data.ref('memberships.organization.members.userId') && request.modifiedFields.all(field, field == 'assignedIssues')",
      delete: 'false',
    },
    fields: { email: 'auth.id != null && auth.id == data.id' },
  },
  organizations: {
    allow: {
      view: 'isMember',
      create: 'false',
      update: 'auth.id != null && auth.id == data.ownerId',
      delete: 'false',
    },
    bind: ['isMember', "auth.id != null && auth.id in data.ref('members.userId')"],
  },
  memberships: {
    allow: {
      view: "auth.id != null && auth.id in data.ref('organization.members.userId')",
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },
  teams: {
    allow: {
      view: 'canViewOrg',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
    bind: ['canViewOrg', "auth.id != null && auth.id in data.ref('organization.members.userId')"],
  },
  projects: {
    allow: {
      view: 'canViewOrg',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
    bind: ['canViewOrg', "auth.id != null && auth.id in data.ref('organization.members.userId')"],
  },
  labels: {
    allow: {
      view: 'canViewOrg',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
    bind: ['canViewOrg', "auth.id != null && auth.id in data.ref('organization.members.userId')"],
  },
  issues: {
    allow: {
      view: 'canViewOrg',
      create: 'false',
      update:
        "canViewOrg && request.modifiedFields.all(field, field in ['status', 'priority', 'assigneeId', 'assignee', 'boardPosition', 'revision', 'moveNonce', 'updatedAt', 'estimatePoints', 'comments', 'activities'])",
      delete: 'false',
    },
    bind: ['canViewOrg', "auth.id != null && auth.id in data.ref('organization.members.userId')"],
  },
  comments: {
    allow: {
      view: 'canViewIssue',
      create: 'canViewIssue && auth.id == data.authorId',
      update: 'false',
      delete: 'false',
    },
    bind: ['canViewIssue', "auth.id != null && auth.id in data.ref('issue.organization.members.userId')"],
  },
  activities: {
    allow: {
      view: 'canViewIssue',
      create: 'canViewIssue && auth.id == data.actorId',
      update: 'false',
      delete: 'false',
    },
    bind: ['canViewIssue', "auth.id != null && auth.id in data.ref('issue.organization.members.userId')"],
  },
} satisfies InstantRules;

export default rules;
