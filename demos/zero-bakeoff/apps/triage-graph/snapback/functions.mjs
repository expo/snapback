import {defineJsLiveQuery, defineJsMutation, results, v} from '../../../../_kit/define.mjs';

const inboxRow = v.object({
  issueKey: v.string(), title: v.string(), status: v.string(), priority: v.string(), pageKey: v.string(),
  teamKey: v.string(), projectKey: v.string(), projectName: v.string(), assigneeKey: v.string(),
  assigneeName: v.string(), labels: v.json(), commentCount: v.integer(), updatedAt: v.integer(),
});

export const inbox = defineJsLiveQuery({
  args: {
    teamKey: v.optional(v.string()), status: v.optional(v.string()), priority: v.optional(v.string()),
    labelKey: v.optional(v.string()), assigneeKey: v.optional(v.string()), after: v.optional(v.string()),
  },
  reads: ['memberships', 'issues', 'issueLabels', 'labels', 'projects', 'users'],
  result: results.records(inboxRow),
  handler: async (ctx, args) => {
    const memberships = await ctx.db.query('memberships').withIndex('by_user_team').eq('userKey', ctx.auth.userId).collect();
    const teamKeys = memberships.map((row) => row.teamKey);
    const assigned = await ctx.db.query('issues').withIndex('by_assignee_page').eq('assigneeKey', ctx.auth.userId).collect();
    const accessible = teamKeys.length === 0
      ? []
      : await ctx.db.query('issues').withIndex('by_team_page').in('teamKey', teamKeys).collect();
    const byKey = new Map();
    for (const issue of accessible.concat(assigned)) byKey.set(issue.issueKey, issue);
    let issues = Array.from(byKey.values());
    if (args.teamKey) issues = issues.filter((row) => row.teamKey === args.teamKey);
    if (args.status) issues = issues.filter((row) => row.status === args.status);
    if (args.priority) issues = issues.filter((row) => row.priority === args.priority);
    if (args.assigneeKey) issues = issues.filter((row) => row.assigneeKey === args.assigneeKey);
    if (args.after) issues = issues.filter((row) => row.pageKey < args.after);
    if (args.labelKey) {
      const links = await ctx.db.query('issueLabels').withIndex('by_label_issue').eq('labelKey', args.labelKey).collect();
      const matching = new Set(links.map((row) => row.issueKey));
      issues = issues.filter((row) => matching.has(row.issueKey));
    }
    issues.sort((left, right) => right.pageKey.localeCompare(left.pageKey));
    const output = [];
    for (const issue of issues.slice(0, 50)) {
      const projectRows = await ctx.db.query('projects').withIndex('by_project_key').eq('projectKey', issue.projectKey).collect();
      const assigneeRows = await ctx.db.query('users').withIndex('by_user_key').eq('userKey', issue.assigneeKey).collect();
      const links = await ctx.db.query('issueLabels').withIndex('by_issue_label').eq('issueKey', issue.issueKey).collect();
      const labelRows = links.length === 0 ? [] : await ctx.db.query('labels').withIndex('by_label_key').in('labelKey', links.map((row) => row.labelKey)).collect();
      output.push({
        issueKey: issue.issueKey, title: issue.title, status: issue.status, priority: issue.priority,
        pageKey: issue.pageKey, teamKey: issue.teamKey, projectKey: issue.projectKey,
        projectName: projectRows[0]?.name ?? '', assigneeKey: issue.assigneeKey,
        assigneeName: assigneeRows[0]?.name ?? '', labels: labelRows.map((row) => ({labelKey: row.labelKey, name: row.name})),
        commentCount: issue.commentCount, updatedAt: issue.updatedAt,
      });
    }
    return output;
  },
});

export const issueDetail = defineJsLiveQuery({
  args: {issueKey: v.string()},
  reads: ['memberships', 'issues', 'comments', 'activities'],
  result: results.records(v.object({issue: v.json(), comments: v.json(), activities: v.json()})),
  handler: async (ctx, args) => {
    const issues = await ctx.db.query('issues').withIndex('by_issue_key').eq('issueKey', args.issueKey).collect();
    const issue = issues[0];
    if (!issue) return [];
    const memberships = await ctx.db.query('memberships').withIndex('by_team_user').eq('teamKey', issue.teamKey).eq('userKey', ctx.auth.userId).collect();
    if (memberships.length === 0 && issue.assigneeKey !== ctx.auth.userId) return [];
    const comments = await ctx.db.query('comments').withIndex('by_issue_time').eq('issueKey', issue.issueKey).collect();
    const activities = await ctx.db.query('activities').withIndex('by_issue_time').eq('issueKey', issue.issueKey).collect();
    comments.sort((left, right) => right.createdAt - left.createdAt);
    activities.sort((left, right) => right.createdAt - left.createdAt);
    return [{issue, comments: comments.slice(0, 20), activities: activities.slice(0, 20)}];
  },
});

export const patchIssue = defineJsMutation({
  args: {issueKey: v.string(), title: v.optional(v.string()), status: v.optional(v.string()), priority: v.optional(v.string()), updatedAt: v.integer()},
  reads: ['issues', 'memberships'], writes: ['issues'], result: results.value(v.string()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('issues').withIndex('by_issue_key').eq('issueKey', args.issueKey).collect();
    const issue = rows[0];
    if (!issue) throw new Error('issue not found');
    const memberships = await ctx.db.query('memberships').withIndex('by_team_user').eq('teamKey', issue.teamKey).eq('userKey', ctx.auth.userId).collect();
    if (memberships.length === 0 && issue.assigneeKey !== ctx.auth.userId) throw new Error('issue not found');
    const patch = {updatedAt: args.updatedAt};
    if (args.title !== undefined) patch.title = args.title;
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    await ctx.db.patch('issues', issue._id, patch);
    return issue.issueKey;
  },
});

export const ingestFixtureBatch = defineJsMutation({
  args: {kind: v.string(), rows: v.json()},
  writes: ['users', 'organizations', 'teams', 'memberships', 'projects', 'labels', 'issues', 'issueLabels', 'comments', 'activities'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    if (!Array.isArray(args.rows) || args.rows.length > 900) throw new Error('fixture batch must contain at most 900 rows');
    const allowed = ['users', 'organizations', 'teams', 'memberships', 'projects', 'labels', 'issues', 'issueLabels', 'comments', 'activities'];
    if (!allowed.includes(args.kind)) throw new Error('unknown fixture table');
    for (const row of args.rows) await ctx.db.insert(args.kind, row);
    return args.rows.length;
  },
});
