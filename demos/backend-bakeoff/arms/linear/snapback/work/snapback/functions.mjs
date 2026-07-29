import {
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  v,
} from '../../../../../../_kit/define.mjs';

const issueShape = v.object({
  organizationId: v.string(),
  teamId: v.string(),
  projectId: v.string(),
  assigneeId: v.string(),
  identifier: v.string(),
  sequence: v.integer(),
  title: v.string(),
  description: v.string(),
  status: v.string(),
  priority: v.integer(),
  boardPosition: v.integer(),
});
const teamShape = v.object({ organizationId: v.string(), name: v.string(), key: v.string() });
const projectShape = v.object({ organizationId: v.string(), name: v.string(), state: v.string() });
const labelShape = v.object({ organizationId: v.string(), name: v.string(), color: v.string() });
const issueLabelShape = v.object({ organizationId: v.string(), issueId: v.string(), labelId: v.string() });
const commentShape = v.object({
  organizationId: v.string(), issueId: v.string(), authorId: v.string(),
  sequence: v.integer(), body: v.string(),
});
const activityShape = v.object({
  organizationId: v.string(), issueId: v.string(), actorId: v.string(),
  sequence: v.integer(), kind: v.string(), body: v.string(),
});

export const listIssues = defineJsLiveQuery({
  auth: 'authenticated',
  args: {
    organizationId: v.id('organizations'),
    status: v.optional(v.string()),
    assigneeId: v.optional(v.principal()),
    projectId: v.optional(v.id('projects')),
    labelId: v.optional(v.id('labels')),
  },
  source: 'handlers.mjs',
  exportName: 'listIssues',
  reads: ['organizationMembers', 'issues', 'issueLabels'],
  result: issueShape,
});
export const pageIssues = defineJsQuery({
  auth: 'authenticated',
  args: {
    organizationId: v.id('organizations'),
    afterSequence: v.optional(v.integer()),
    limit: v.integer(),
  },
  source: 'handlers.mjs',
  exportName: 'pageIssues',
  reads: ['organizationMembers', 'issues'],
  result: issueShape,
});
export const listTeams = defineJsQuery({
  auth: 'authenticated', args: { organizationId: v.id('organizations') },
  source: 'handlers.mjs', exportName: 'listTeams',
  reads: ['organizationMembers', 'teams'], result: teamShape,
});
export const listProjects = defineJsQuery({
  auth: 'authenticated', args: { organizationId: v.id('organizations') },
  source: 'handlers.mjs', exportName: 'listProjects',
  reads: ['organizationMembers', 'projects'], result: projectShape,
});
export const listLabels = defineJsQuery({
  auth: 'authenticated', args: { organizationId: v.id('organizations') },
  source: 'handlers.mjs', exportName: 'listLabels',
  reads: ['organizationMembers', 'labels'], result: labelShape,
});
export const listIssueLabels = defineJsQuery({
  auth: 'authenticated', args: { issueId: v.id('issues') },
  source: 'handlers.mjs', exportName: 'listIssueLabels',
  reads: ['issues', 'organizationMembers', 'issueLabels'], result: issueLabelShape,
});
export const listComments = defineJsLiveQuery({
  auth: 'authenticated', args: { issueId: v.id('issues') },
  source: 'handlers.mjs', exportName: 'listComments',
  reads: ['issues', 'organizationMembers', 'comments'], result: commentShape,
});
export const listActivities = defineJsLiveQuery({
  auth: 'authenticated', args: { issueId: v.id('issues') },
  source: 'handlers.mjs', exportName: 'listActivities',
  reads: ['issues', 'organizationMembers', 'activities'], result: activityShape,
});
export const listOrganizationComments = defineJsQuery({
  auth: 'authenticated', args: { organizationId: v.id('organizations') },
  source: 'handlers.mjs', exportName: 'listOrganizationComments',
  reads: ['organizationMembers', 'comments'], result: commentShape,
});
export const listOrganizationActivities = defineJsQuery({
  auth: 'authenticated', args: { organizationId: v.id('organizations') },
  source: 'handlers.mjs', exportName: 'listOrganizationActivities',
  reads: ['organizationMembers', 'activities'], result: activityShape,
});
export const bootstrapOrganization = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string(), slug: v.string(), seedPrimary: v.boolean(), bobId: v.principal() },
  source: 'handlers.mjs', exportName: 'bootstrapOrganization',
  writes: ['organizations', 'organizationMembers', 'teams', 'projects', 'labels', 'issues', 'issueLabels', 'comments', 'activities'],
});
export const seedIssuesBatch = defineJsMutation({
  auth: 'authenticated',
  args: {
    organizationId: v.id('organizations'), bobId: v.principal(),
    startSequence: v.integer(), count: v.integer(),
  },
  source: 'handlers.mjs', exportName: 'seedIssuesBatch',
  reads: ['organizationMembers', 'teams', 'projects', 'labels'],
  writes: ['issues', 'issueLabels', 'comments', 'activities'],
});
export const addMember = defineJsMutation({
  auth: 'authenticated', authorityCreating: true,
  args: { organizationId: v.id('organizations'), userId: v.principal() },
  source: 'handlers.mjs', exportName: 'addMember',
  reads: ['organizationMembers'], writes: ['organizationMembers'],
});
export const createIssue = defineJsMutation({
  auth: 'authenticated',
  args: {
    organizationId: v.id('organizations'), teamId: v.id('teams'), projectId: v.id('projects'),
    assigneeId: v.principal(), title: v.string(), sequence: v.integer(),
  },
  source: 'handlers.mjs', exportName: 'createIssue',
  reads: ['organizationMembers', 'teams', 'projects'], writes: ['issues', 'activities'],
});
export const updateIssue = defineJsMutation({
  auth: 'authenticated',
  args: {
    id: v.id('issues'), status: v.optional(v.string()), priority: v.optional(v.integer()),
    assigneeId: v.optional(v.principal()), boardPosition: v.optional(v.integer()),
    title: v.optional(v.string()),
  },
  source: 'handlers.mjs', exportName: 'updateIssue',
  reads: ['organizationMembers', 'issues'], writes: ['issues', 'activities'],
});
export const addComment = defineJsMutation({
  auth: 'authenticated',
  args: { issueId: v.id('issues'), body: v.string(), sequence: v.integer() },
  source: 'handlers.mjs', exportName: 'addComment',
  reads: ['issues', 'organizationMembers'], writes: ['comments', 'activities'],
});
