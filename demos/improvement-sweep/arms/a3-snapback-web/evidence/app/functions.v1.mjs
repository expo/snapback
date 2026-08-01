import {
  arg,
  asc,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineQuery,
  defineSearchQuery,
  eq,
  gteFilter,
  lteFilter,
  membershipResource,
  results,
  v,
} from '@expo/snapback-codegen/define';
import { defineOwnedKeysetPages } from '@expo/snapback-codegen/standard-patterns';
import schema, { issues, orgMembers } from './schema.mjs';

// LLP 0137 A3 collaborative issue and planning board.
// Every protected operation gates through the orgMembers scoped-role
// declaration: guests read and comment, members and owners write, owners
// administer projects/labels; the outsider gets the uniform
// SNAPBACK_AUTH_PERMISSION_DENIED on read, subscribe, and write.

// (Handlers keep their logic inline: inline handler v1 does not capture
// sibling helpers, so each handler is a self-contained expression.)

// ---- membership entry (seeded invites; the only mutation using the
// by:['none'] self-insert transition) ----

export const redeemInvite = defineJsMutation({
  args: { code: v.string() },
  reads: ['orgInvites'],
  writes: ['orgInvites', 'orgMembers'],
  authorityCreating: true,
  result: results.value(v.object({ orgId: v.id('organizations'), role: v.string() })),
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query('orgInvites')
      .withIndex('by_code')
      .eq('code', args.code)
      .collect();
    const invite = invites[0];
    if (!invite || invite.consumed) throw new Error('invite code is not redeemable');
    await ctx.membership.orgMembers.insert({
      orgId: invite.orgId,
      userId: ctx.auth.userId,
      role: invite.role,
    });
    await ctx.db.patch('orgInvites', invite._id, { consumed: true });
    return { orgId: invite.orgId, role: invite.role };
  },
});

// ---- board reads ----

export const columnIssues = defineJsLiveQuery({
  args: { orgId: v.id('organizations'), status: v.string() },
  reads: ['issues', 'orgMembers'],
  result: results.documents('issues'),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner', 'member', 'guest');
    const rows = await ctx.db
      .query('issues')
      .withIndex('by_org_status_position')
      .eq('orgId', args.orgId)
      .eq('status', args.status)
      .take(200)
      .collect();
    rows.sort((a, b) =>
      a.boardPosition - b.boardPosition
      || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    return rows;
  },
});

export const boardAggregates = defineJsLiveQuery({
  args: { orgId: v.id('organizations') },
  reads: ['issues', 'orgMembers'],
  result: results.records(v.object({
    total: v.integer(),
    todo: v.integer(),
    inProgress: v.integer(),
    review: v.integer(),
    done: v.integer(),
    urgent: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner', 'member', 'guest');
    const rows = await ctx.db
      .query('issues')
      .withIndex('by_org')
      .eq('orgId', args.orgId)
      .take(500)
      .collect();
    const counts = { total: rows.length, todo: 0, inProgress: 0, review: 0, done: 0, urgent: 0 };
    for (const row of rows) {
      if (row.status === 'todo') counts.todo += 1;
      else if (row.status === 'in-progress') counts.inProgress += 1;
      else if (row.status === 'review') counts.review += 1;
      else if (row.status === 'done') counts.done += 1;
      if (row.priority === 4) counts.urgent += 1;
    }
    return [counts];
  },
});

export const orgDirectory = defineJsQuery({
  args: { orgId: v.id('organizations') },
  reads: ['organizations', 'teams', 'projects', 'labels', 'orgMembers'],
  result: results.records(v.object({
    orgName: v.string(),
    teams: v.array(v.object({ _id: v.id('teams'), key: v.string(), name: v.string() })),
    projects: v.array(v.object({ _id: v.id('projects'), teamId: v.id('teams'), name: v.string(), status: v.string() })),
    labels: v.array(v.object({ _id: v.id('labels'), name: v.string(), color: v.string() })),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner', 'member', 'guest');
    const org = await ctx.db.get('organizations', args.orgId);
    if (!org) throw new Error('organization not found');
    const teams = await ctx.db.query('teams').withIndex('by_org').eq('orgId', args.orgId).take(50).collect();
    const projects = await ctx.db.query('projects').withIndex('by_org').eq('orgId', args.orgId).take(100).collect();
    const labels = await ctx.db.query('labels').withIndex('by_org').eq('orgId', args.orgId).take(100).collect();
    return [{
      orgName: org.name,
      teams: teams.map((t) => ({ _id: t._id, key: t.key, name: t.name })),
      projects: projects.map((p) => ({ _id: p._id, teamId: p.teamId, name: p.name, status: p.status })),
      labels: labels.map((l) => ({ _id: l._id, name: l.name, color: l.color })),
    }];
  },
});

// Issue detail: related project/team/assignee/labels plus bounded comment and
// activity pages and exact bounded aggregates, composed in one snapshot.
export const issueDetail = defineJsQuery({
  args: { issueId: v.id('issues') },
  reads: ['issues', 'projects', 'teams', 'labels', 'issueLabels', 'comments', 'activity', 'orgMembers'],
  result: results.records(v.object({
    issue: v.object({
      _id: v.id('issues'),
      identifier: v.string(),
      title: v.string(),
      description: v.string(),
      status: v.string(),
      priority: v.integer(),
      assigneeId: v.principal(),
      assigneeName: v.string(),
      boardPosition: v.integer(),
      revision: v.integer(),
      updatedAt: v.integer(),
    }),
    projectName: v.string(),
    teamName: v.string(),
    labels: v.array(v.object({ _id: v.id('labels'), name: v.string(), color: v.string() })),
    comments: v.array(v.object({ seq: v.integer(), authorName: v.string(), body: v.string(), createdAt: v.integer() })),
    activity: v.array(v.object({ seq: v.integer(), actorName: v.string(), kind: v.string(), detail: v.string(), createdAt: v.integer() })),
    aggregates: v.object({
      commentCount: v.integer(),
      activityCount: v.integer(),
      labelCount: v.integer(),
    }),
  })),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member', 'guest');
    const project = await ctx.db.get('projects', issue.projectId);
    const team = await ctx.db.get('teams', issue.teamId);
    const edges = await ctx.db
      .query('issueLabels')
      .withIndex('by_issue')
      .eq('issueId', issue._id)
      .take(32)
      .collect();
    const labels = [];
    for (const edge of edges) {
      const label = await ctx.db.get('labels', edge.labelId);
      if (label) labels.push({ _id: label._id, name: label.name, color: label.color });
    }
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_issue_seq')
      .eq('issueId', issue._id)
      .take(50)
      .collect();
    comments.sort((a, b) => a.seq - b.seq);
    const activity = await ctx.db
      .query('activity')
      .withIndex('by_issue_seq')
      .eq('issueId', issue._id)
      .take(50)
      .collect();
    activity.sort((a, b) => a.seq - b.seq);
    return [{
      issue: {
        _id: issue._id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId,
        assigneeName: issue.assigneeName,
        boardPosition: issue.boardPosition,
        revision: issue.revision,
        updatedAt: issue.updatedAt,
      },
      projectName: project ? project.name : '',
      teamName: team ? team.name : '',
      labels,
      comments: comments.map((c) => ({ seq: c.seq, authorName: c.authorName, body: c.body, createdAt: c.createdAt })),
      activity: activity.map((a) => ({ seq: a.seq, actorName: a.actorName, kind: a.kind, detail: a.detail, createdAt: a.createdAt })),
      aggregates: {
        commentCount: comments.length,
        activityCount: activity.length,
        labelCount: labels.length,
      },
    }];
  },
});

export const commentsForIssue = defineJsLiveQuery({
  args: { issueId: v.id('issues') },
  reads: ['comments', 'issues', 'orgMembers'],
  result: results.documents('comments'),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member', 'guest');
    const rows = await ctx.db
      .query('comments')
      .withIndex('by_issue_seq')
      .eq('issueId', args.issueId)
      .take(100)
      .collect();
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  },
});

export const activityForIssue = defineJsLiveQuery({
  args: { issueId: v.id('issues') },
  reads: ['activity', 'issues', 'orgMembers'],
  result: results.documents('activity'),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member', 'guest');
    const rows = await ctx.db
      .query('activity')
      .withIndex('by_issue_seq')
      .eq('issueId', args.issueId)
      .take(100)
      .collect();
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  },
});

export const orgActivity = defineJsLiveQuery({
  args: { orgId: v.id('organizations') },
  reads: ['activity', 'orgMembers'],
  result: results.documents('activity'),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner', 'member', 'guest');
    const rows = await ctx.db
      .query('activity')
      .withIndex('by_org_created')
      .eq('orgId', args.orgId)
      .order('createdAt', 'desc')
      .take(30)
      .collect();
    return rows;
  },
});

// Declarative indexed range over by_org_updated, membership-gated. Note the
// declarative membership idiom uses filter semantics for non-members
// (LLP 0137 finding 0137-a1-f7): the positive range facts are asserted here,
// outsider denial is asserted against the requireRole surfaces.
export const issuesUpdatedInRange = defineQuery({
  table: 'issues',
  args: { orgId: v.id('organizations'), since: v.integer(), until: v.integer() },
  membership: [orgMembers.hasRole(membershipResource.arg('orgId'), 'owner', 'member', 'guest')],
  filter: [
    eq('orgId', arg('orgId')),
    gteFilter('updatedAt', arg('since')),
    lteFilter('updatedAt', arg('until')),
  ],
  order: [asc('updatedAt')],
  index: 'by_org_updated',
});

// Org-wide keyset pagination over the unique (orgId, pageKey) index. The
// packaged ctx.db chain has no strict-greater verb (0137-a2-f5), so the
// boundary is applied with gte + boundary-exclusion on the exact key; the
// window itself is index-served and bounded.
export const pageIssues = defineJsQuery({
  args: { orgId: v.id('organizations'), after: v.optional(v.string()), limit: v.integer() },
  reads: ['issues', 'orgMembers'],
  result: results.records(v.object({
    pageKey: v.string(),
    identifier: v.string(),
    title: v.string(),
    status: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner', 'member', 'guest');
    if (args.limit < 1 || args.limit > 50) throw new Error('limit must be 1..50');
    const rows = await ctx.db
      .query('issues')
      .withIndex('by_org_page_key')
      .eq('orgId', args.orgId)
      .take(200)
      .collect();
    rows.sort((a, b) => (a.pageKey < b.pageKey ? -1 : a.pageKey > b.pageKey ? 1 : 0));
    const after = args.after === undefined ? null : args.after;
    const start = after === null ? 0 : rows.findIndex((r) => r.pageKey > after);
    const window = start === -1 ? [] : rows.slice(start, start + args.limit);
    return window.map((r) => ({
      pageKey: r.pageKey,
      identifier: r.identifier,
      title: r.title,
      status: r.status,
    }));
  },
});

// Supported-path keyset pages: the generated first/next pair over the unique
// (assigneeId, pageKey) partition — "my issues", opaque versioned cursor.
export const { myIssuesFirstPage, myIssuesNextPage } = defineOwnedKeysetPages({
  table: schema.tables.issues,
  names: { first: 'myIssuesFirstPage', next: 'myIssuesNextPage' },
  index: 'by_assignee_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'assigneeId' },
  limit: 3,
});

// Supported-path full-text search: owner partition (assignee) — the v1
// search visibility model accepts owner or public-read only, so org-wide
// membership-scoped search is an explicit GAP recorded by the arm.
export const searchMyIssues = defineSearchQuery({
  table: issues,
  index: 'search_issues',
});

// ---- writes ----

export const createIssue = defineJsMutation({
  args: {
    orgId: v.id('organizations'),
    teamId: v.id('teams'),
    projectId: v.id('projects'),
    title: v.string(),
    description: v.string(),
    priority: v.integer(),
    actorName: v.string(),
  },
  reads: ['organizations', 'issues', 'orgMembers'],
  writes: ['organizations', 'issues', 'activity'],
  result: results.value(v.object({ issueId: v.id('issues'), identifier: v.string() })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner', 'member');
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('issue title is required');
    if (args.priority < 0 || args.priority > 4) throw new Error('priority must be 0..4');
    const org = await ctx.db.get('organizations', args.orgId);
    if (!org) throw new Error('organization not found');
    const number = org.nextIssueNumber;
    await ctx.db.patch('organizations', args.orgId, { nextIssueNumber: number + 1 });
    const identifier = `ISS-${number}`;
    const now = ctx.runtime.now();
    const issueId = await ctx.db.insert('issues', {
      orgId: args.orgId,
      teamId: args.teamId,
      projectId: args.projectId,
      identifier,
      title,
      description: String(args.description ?? ''),
      status: 'todo',
      priority: args.priority,
      assigneeId: ctx.auth.userId,
      assigneeName: args.actorName,
      boardPosition: number * 100,
      revision: 1,
      commentSeq: 0,
      activitySeq: 1,
      pageKey: `pk_${number}_${ctx.runtime.id()}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('activity', {
      orgId: args.orgId,
      issueId,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'created',
      detail: `created ${identifier}`,
      seq: 1,
      createdAt: now,
    });
    return { issueId, identifier };
  },
});

export const updateIssue = defineJsMutation({
  args: {
    issueId: v.id('issues'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    actorName: v.string(),
  },
  reads: ['issues', 'orgMembers'],
  writes: ['issues', 'activity'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member');
    const patch = { revision: issue.revision + 1, updatedAt: ctx.runtime.now() };
    if (args.title !== undefined) patch.title = String(args.title).trim();
    if (args.description !== undefined) patch.description = String(args.description);
    const seq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'edited',
      detail: `edited ${issue.identifier}`,
      seq,
      createdAt: ctx.runtime.now(),
    });
    patch.activitySeq = seq;
    await ctx.db.patch('issues', args.issueId, patch);
    return patch.revision;
  },
});

export const setStatus = defineJsMutation({
  args: {
    issueId: v.id('issues'),
    status: v.string(),
    boardPosition: v.integer(),
    actorName: v.string(),
  },
  reads: ['issues', 'orgMembers'],
  writes: ['issues', 'activity'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member');
    const allowed = ['todo', 'in-progress', 'review', 'done'];
    if (!allowed.includes(args.status)) throw new Error('invalid status');
    const seq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'status',
      detail: `${issue.status} → ${args.status}`,
      seq,
      createdAt: ctx.runtime.now(),
    });
    const revision = issue.revision + 1;
    await ctx.db.patch('issues', args.issueId, {
      status: args.status,
      boardPosition: args.boardPosition,
      revision,
      activitySeq: seq,
      updatedAt: ctx.runtime.now(),
    });
    return revision;
  },
});

export const assignIssue = defineJsMutation({
  args: {
    issueId: v.id('issues'),
    assigneeId: v.principal(),
    assigneeName: v.string(),
    actorName: v.string(),
  },
  reads: ['issues', 'orgMembers'],
  writes: ['issues', 'activity'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member');
    const seq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'assignee',
      detail: `assigned to ${args.assigneeName}`,
      seq,
      createdAt: ctx.runtime.now(),
    });
    const revision = issue.revision + 1;
    await ctx.db.patch('issues', args.issueId, {
      assigneeId: args.assigneeId,
      assigneeName: args.assigneeName,
      revision,
      activitySeq: seq,
      updatedAt: ctx.runtime.now(),
    });
    return revision;
  },
});

export const setPriority = defineJsMutation({
  args: { issueId: v.id('issues'), priority: v.integer(), actorName: v.string() },
  reads: ['issues', 'orgMembers'],
  writes: ['issues', 'activity'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member');
    if (args.priority < 0 || args.priority > 4) throw new Error('priority must be 0..4');
    const seq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'priority',
      detail: `priority ${issue.priority} → ${args.priority}`,
      seq,
      createdAt: ctx.runtime.now(),
    });
    const revision = issue.revision + 1;
    await ctx.db.patch('issues', args.issueId, {
      priority: args.priority,
      revision,
      activitySeq: seq,
      updatedAt: ctx.runtime.now(),
    });
    return revision;
  },
});

// Compare-and-move: the documented deterministic conflict semantics for
// concurrent board moves. A mover names the revision it observed; the first
// commit wins and bumps the revision, the second refuses with a stale-move
// error and must rebase on the authoritative row.
export const moveIssue = defineJsMutation({
  args: {
    issueId: v.id('issues'),
    boardPosition: v.integer(),
    expectedRevision: v.integer(),
    actorName: v.string(),
  },
  reads: ['issues', 'orgMembers'],
  writes: ['issues', 'activity'],
  result: results.value(v.object({ revision: v.integer(), boardPosition: v.integer() })),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member');
    if (issue.revision !== args.expectedRevision) {
      throw new Error(`stale move: revision ${issue.revision}, expected ${args.expectedRevision}`);
    }
    const seq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'moved',
      detail: `position ${issue.boardPosition} → ${args.boardPosition}`,
      seq,
      createdAt: ctx.runtime.now(),
    });
    const revision = issue.revision + 1;
    await ctx.db.patch('issues', args.issueId, {
      boardPosition: args.boardPosition,
      revision,
      activitySeq: seq,
      updatedAt: ctx.runtime.now(),
    });
    return { revision, boardPosition: args.boardPosition };
  },
});

// Comments: guests may comment; idempotent by (issueId, clientKey).
export const addComment = defineJsMutation({
  args: {
    issueId: v.id('issues'),
    body: v.string(),
    clientKey: v.string(),
    authorName: v.string(),
  },
  reads: ['issues', 'comments', 'orgMembers'],
  writes: ['issues', 'comments', 'activity'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member', 'guest');
    const body = String(args.body ?? '').trim();
    if (!body) throw new Error('comment body is required');
    const existing = await ctx.db
      .query('comments')
      .withIndex('by_issue_client_key')
      .eq('issueId', args.issueId)
      .eq('clientKey', args.clientKey)
      .collect();
    if (existing.length > 0) return existing[0].seq;
    const seq = issue.commentSeq + 1;
    const now = ctx.runtime.now();
    await ctx.db.insert('comments', {
      orgId: issue.orgId,
      issueId: issue._id,
      authorId: ctx.auth.userId,
      authorName: args.authorName,
      body,
      seq,
      clientKey: args.clientKey,
      createdAt: now,
    });
    const activitySeq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.authorName,
      kind: 'commented',
      detail: `commented on ${issue.identifier}`,
      seq: activitySeq,
      createdAt: now,
    });
    await ctx.db.patch('issues', args.issueId, {
      commentSeq: seq,
      activitySeq,
    });
    return seq;
  },
});

// Owner-only administration.
export const createProject = defineJsMutation({
  args: { orgId: v.id('organizations'), teamId: v.id('teams'), name: v.string() },
  reads: ['orgMembers'],
  writes: ['projects'],
  result: results.value(v.id('projects')),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner');
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('project name is required');
    return await ctx.db.insert('projects', {
      orgId: args.orgId,
      teamId: args.teamId,
      name,
      status: 'active',
    });
  },
});

export const createLabel = defineJsMutation({
  args: { orgId: v.id('organizations'), name: v.string(), color: v.string() },
  reads: ['orgMembers'],
  writes: ['labels'],
  result: results.value(v.id('labels')),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'owner');
    return await ctx.db.insert('labels', {
      orgId: args.orgId,
      name: String(args.name ?? '').trim(),
      color: String(args.color ?? '#888888'),
    });
  },
});

export const addLabelToIssue = defineJsMutation({
  args: { issueId: v.id('issues'), labelId: v.id('labels'), actorName: v.string() },
  reads: ['issues', 'issueLabels', 'labels', 'orgMembers'],
  writes: ['issueLabels', 'issues', 'activity'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get('issues', args.issueId);
    if (!issue) throw new Error('issue not found');
    await ctx.permissions.orgMembers.requireRole(issue.orgId, 'owner', 'member');
    const existing = await ctx.db
      .query('issueLabels')
      .withIndex('by_issue_label')
      .eq('issueId', args.issueId)
      .eq('labelId', args.labelId)
      .collect();
    if (existing.length > 0) return false;
    const label = await ctx.db.get('labels', args.labelId);
    if (!label) throw new Error('label not found');
    await ctx.db.insert('issueLabels', {
      orgId: issue.orgId,
      issueId: args.issueId,
      labelId: args.labelId,
    });
    const seq = issue.activitySeq + 1;
    await ctx.db.insert('activity', {
      orgId: issue.orgId,
      issueId: issue._id,
      actorId: ctx.auth.userId,
      actorName: args.actorName,
      kind: 'labeled',
      detail: `added ${label.name}`,
      seq,
      createdAt: ctx.runtime.now(),
    });
    await ctx.db.patch('issues', args.issueId, { activitySeq: seq });
    return true;
  },
});

// Self-retirement of a seat (the private-roster v1 posture has no admin
// kick; cleanup retires authority by self-removal).
export const leaveOrg = defineJsMutation({
  args: { orgId: v.id('organizations') },
  writes: ['orgMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.orgMembers.removeSelf(args.orgId);
    return true;
  },
});
