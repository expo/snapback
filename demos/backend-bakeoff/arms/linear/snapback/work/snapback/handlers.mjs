const PAGE_SIZE = 50;

function requiredText(value, label) {
  const text = String(value).trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

async function requireMember(ctx, organizationId) {
  await ctx.permissions.organizationMembers.requireRole(organizationId, 'owner', 'member');
}

async function issueAndMember(ctx, issueId) {
  const issue = await ctx.db.get('issues', issueId);
  if (!issue) throw new Error('issue not found');
  await requireMember(ctx, issue.organizationId);
  return issue;
}

globalThis.__snapbackHandlers = {
  async listIssues(ctx, args) {
    await requireMember(ctx, args.organizationId);
    let rows;
    if (args.status !== undefined) {
      rows = await ctx.db.query('issues').withIndex('by_organization_status')
        .eq('organizationId', args.organizationId).eq('status', args.status).collect();
    } else if (args.assigneeId !== undefined) {
      rows = await ctx.db.query('issues').withIndex('by_organization_assignee')
        .eq('organizationId', args.organizationId).eq('assigneeId', args.assigneeId).collect();
    } else if (args.projectId !== undefined) {
      rows = await ctx.db.query('issues').withIndex('by_organization_project')
        .eq('organizationId', args.organizationId).eq('projectId', args.projectId).collect();
    } else {
      rows = await ctx.db.query('issues').withIndex('by_organization_sequence')
        .eq('organizationId', args.organizationId).order('sequence', 'asc').collect();
    }
    if (args.labelId !== undefined) {
      const links = await ctx.db.query('issueLabels').withIndex('by_label_issue')
        .eq('labelId', args.labelId).collect();
      const ids = new Set(links.map((row) => row.issueId));
      rows = rows.filter((row) => ids.has(row._id));
    }
    return rows.sort((a, b) => a.sequence - b.sequence || a._id.localeCompare(b._id));
  },

  async pageIssues(ctx, args) {
    await requireMember(ctx, args.organizationId);
    if (args.limit !== PAGE_SIZE) throw new Error('frozen page limit is 50');
    const rows = await ctx.db.query('issues').withIndex('by_organization_sequence')
      .eq('organizationId', args.organizationId).order('sequence', 'asc').collect();
    const after = args.afterSequence ?? -1;
    return rows.filter((row) => row.sequence > after).slice(0, PAGE_SIZE);
  },

  async listTeams(ctx, args) {
    await requireMember(ctx, args.organizationId);
    return await ctx.db.query('teams').withIndex('by_organization_key')
      .eq('organizationId', args.organizationId).order('key', 'asc').collect();
  },

  async listProjects(ctx, args) {
    await requireMember(ctx, args.organizationId);
    return await ctx.db.query('projects').withIndex('by_organization_name')
      .eq('organizationId', args.organizationId).order('name', 'asc').collect();
  },

  async listLabels(ctx, args) {
    await requireMember(ctx, args.organizationId);
    return await ctx.db.query('labels').withIndex('by_organization_name')
      .eq('organizationId', args.organizationId).order('name', 'asc').collect();
  },

  async listIssueLabels(ctx, args) {
    await issueAndMember(ctx, args.issueId);
    return await ctx.db.query('issueLabels').withIndex('by_issue_label')
      .eq('issueId', args.issueId).collect();
  },

  async listComments(ctx, args) {
    await issueAndMember(ctx, args.issueId);
    return await ctx.db.query('comments').withIndex('by_issue_sequence')
      .eq('issueId', args.issueId).order('sequence', 'asc').collect();
  },

  async listActivities(ctx, args) {
    await issueAndMember(ctx, args.issueId);
    return await ctx.db.query('activities').withIndex('by_issue_sequence')
      .eq('issueId', args.issueId).order('sequence', 'asc').collect();
  },

  async listOrganizationComments(ctx, args) {
    await requireMember(ctx, args.organizationId);
    return (await ctx.db.query('comments').collect())
      .filter((row) => row.organizationId === args.organizationId);
  },

  async listOrganizationActivities(ctx, args) {
    await requireMember(ctx, args.organizationId);
    return (await ctx.db.query('activities').collect())
      .filter((row) => row.organizationId === args.organizationId);
  },

  async bootstrapOrganization(ctx, args) {
    const organizationId = await ctx.membership.organizationMembers.bootstrap({
      name: requiredText(args.name, 'organization name'),
      slug: requiredText(args.slug, 'organization slug'),
      createdBy: ctx.auth.userId,
    });
    if (!args.seedPrimary) return organizationId;

    const teamIds = [];
    for (let index = 0; index < 3; index += 1) {
      teamIds.push(await ctx.db.insert('teams', {
        organizationId,
        name: ['Engineering', 'Product', 'Operations'][index],
        key: ['ENG', 'PROD', 'OPS'][index],
      }));
    }
    const projectIds = [];
    for (let index = 0; index < 4; index += 1) {
      projectIds.push(await ctx.db.insert('projects', {
        organizationId,
        name: ['Launch', 'Reliability', 'Mobile', 'Growth'][index],
        state: index === 0 ? 'active' : 'planned',
      }));
    }
    const labelIds = [];
    for (let index = 0; index < 20; index += 1) {
      labelIds.push(await ctx.db.insert('labels', {
        organizationId,
        name: `Label ${String(index + 1).padStart(2, '0')}`,
        color: `hsl(${index * 18} 70% 50%)`,
      }));
    }
    return organizationId;
  },

  async seedIssuesBatch(ctx, args) {
    await ctx.permissions.organizationMembers.requireRole(args.organizationId, 'owner');
    if (args.count !== 100 || args.startSequence < 0 || args.startSequence % 100 !== 0) {
      throw new Error('frozen seed batches are 100 issues aligned to a 100-issue boundary');
    }
    const teamIds = (await ctx.db.query('teams').withIndex('by_organization_key')
      .eq('organizationId', args.organizationId).order('key', 'asc').collect()).map(({ _id }) => _id);
    const projectIds = (await ctx.db.query('projects').withIndex('by_organization_name')
      .eq('organizationId', args.organizationId).order('name', 'asc').collect()).map(({ _id }) => _id);
    const labelIds = (await ctx.db.query('labels').withIndex('by_organization_name')
      .eq('organizationId', args.organizationId).order('name', 'asc').collect()).map(({ _id }) => _id);
    const statuses = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];
    for (let sequence = args.startSequence; sequence < args.startSequence + args.count; sequence += 1) {
      const issueId = await ctx.db.insert('issues', {
        organizationId: args.organizationId,
        teamId: teamIds[sequence % teamIds.length],
        projectId: projectIds[sequence % projectIds.length],
        assigneeId: sequence % 2 === 0 ? ctx.auth.userId : args.bobId,
        identifier: `${['ENG', 'PROD', 'OPS'][sequence % 3]}-${sequence + 1}`,
        sequence,
        title: `Production issue ${String(sequence + 1).padStart(3, '0')}`,
        description: `Seeded issue ${sequence + 1} for the frozen Linear workload`,
        status: statuses[sequence % statuses.length],
        priority: sequence % 5,
        boardPosition: Math.floor(sequence / statuses.length),
      });
      await ctx.db.insert('issueLabels', {
        organizationId: args.organizationId,
        issueId,
        labelId: labelIds[sequence % labelIds.length],
      });
      for (let commentIndex = 0; commentIndex < 2; commentIndex += 1) {
        await ctx.db.insert('comments', {
          organizationId: args.organizationId,
          issueId,
          authorId: commentIndex === 0 ? ctx.auth.userId : args.bobId,
          sequence: commentIndex,
          body: `Comment ${commentIndex + 1} on issue ${sequence + 1}`,
        });
      }
      await ctx.db.insert('activities', {
        organizationId: args.organizationId,
        issueId,
        actorId: ctx.auth.userId,
        sequence: 0,
        kind: 'created',
        body: `Created ${sequence + 1}`,
      });
    }
    return args.count;
  },

  async addMember(ctx, args) {
    await ctx.permissions.organizationMembers.requireRole(args.organizationId, 'owner');
    await ctx.membership.organizationMembers.insert({
      organizationId: args.organizationId,
      userId: args.userId,
      role: 'member',
    });
    return null;
  },

  async createIssue(ctx, args) {
    await requireMember(ctx, args.organizationId);
    const team = await ctx.db.get('teams', args.teamId);
    const project = await ctx.db.get('projects', args.projectId);
    if (team?.organizationId !== args.organizationId || project?.organizationId !== args.organizationId) {
      throw new Error('team/project does not belong to organization');
    }
    const id = await ctx.db.insert('issues', {
      organizationId: args.organizationId,
      teamId: args.teamId,
      projectId: args.projectId,
      assigneeId: args.assigneeId,
      identifier: `${team.key}-${args.sequence + 1}`,
      sequence: args.sequence,
      title: requiredText(args.title, 'title'),
      description: '',
      status: 'backlog',
      priority: 0,
      boardPosition: args.sequence,
    });
    await ctx.db.insert('activities', {
      organizationId: args.organizationId,
      issueId: id,
      actorId: ctx.auth.userId,
      sequence: 0,
      kind: 'created',
      body: 'Created issue',
    });
    return id;
  },

  async updateIssue(ctx, args) {
    const issue = await issueAndMember(ctx, args.id);
    const values = {};
    for (const key of ['status', 'priority', 'assigneeId', 'boardPosition', 'title']) {
      if (args[key] !== undefined) values[key] = args[key];
    }
    if (Object.keys(values).length === 0) return 0;
    const changed = await ctx.db.patch('issues', args.id, values);
    if (changed) {
      const activities = await ctx.db.query('activities').withIndex('by_issue_sequence')
        .eq('issueId', args.id).collect();
      await ctx.db.insert('activities', {
        organizationId: issue.organizationId,
        issueId: args.id,
        actorId: ctx.auth.userId,
        sequence: activities.length,
        kind: 'updated',
        body: Object.keys(values).sort().join(','),
      });
    }
    return changed ? 1 : 0;
  },

  async addComment(ctx, args) {
    const issue = await issueAndMember(ctx, args.issueId);
    const commentId = await ctx.db.insert('comments', {
      organizationId: issue.organizationId,
      issueId: args.issueId,
      authorId: ctx.auth.userId,
      sequence: args.sequence,
      body: requiredText(args.body, 'comment body'),
    });
    await ctx.db.insert('activities', {
      organizationId: issue.organizationId,
      issueId: args.issueId,
      actorId: ctx.auth.userId,
      sequence: args.sequence + 1,
      kind: 'commented',
      body: 'Added comment',
    });
    return commentId;
  },
};
