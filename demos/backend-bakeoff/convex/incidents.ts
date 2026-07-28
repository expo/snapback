import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const incidentId = v.id('incidents');
const clean = (value: string, label: string) => {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
};
const publicIncident = (row: Record<string, unknown> | null) =>
  row === null ? null : { ...row, id: String(row._id) };

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('incidents').withIndex('by_updated').order('desc').collect()).map(
      publicIncident,
    ),
});

export const tasks = query({
  args: { incidentId },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query('tasks')
        .withIndex('by_incident_position', (q) => q.eq('incidentId', args.incidentId))
        .collect()
    ).map((row) => ({ ...row, id: String(row._id), incidentId: String(row.incidentId) })),
});

export const comments = query({
  args: { incidentId },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query('comments')
        .withIndex('by_incident_created', (q) => q.eq('incidentId', args.incidentId))
        .collect()
    ).map((row) => ({ ...row, id: String(row._id), incidentId: String(row.incidentId) })),
});

export const activity = query({
  args: { incidentId },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query('activity')
        .withIndex('by_incident_created', (q) => q.eq('incidentId', args.incidentId))
        .order('desc')
        .collect()
    ).map((row) => ({ ...row, id: String(row._id), incidentId: String(row.incidentId) })),
});

export const allTasks = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('tasks').collect()).map((row) => ({
      ...row,
      id: String(row._id),
      incidentId: String(row.incidentId),
    })),
});

export const allComments = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('comments').collect()).map((row) => ({
      ...row,
      id: String(row._id),
      incidentId: String(row.incidentId),
    })),
});

export const allActivity = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('activity').collect()).map((row) => ({
      ...row,
      id: String(row._id),
      incidentId: String(row.incidentId),
    })),
});

export const search = query({
  args: { term: v.string() },
  handler: async (ctx, args) => {
    const term = args.term.trim();
    const rows = term
      ? await ctx.db
          .query('incidents')
          .withSearchIndex('search_incidents', (q) => q.search('searchText', term))
          .take(20)
      : await ctx.db.query('incidents').withIndex('by_updated').order('desc').take(20);
    return rows.map(publicIncident);
  },
});

export const brief = query({
  args: { incidentId },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error('incident not found');
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_incident_position', (q) => q.eq('incidentId', args.incidentId))
      .collect();
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_incident_created', (q) => q.eq('incidentId', args.incidentId))
      .collect();
    const completed = tasks.filter((task) => task.completed).length;
    const latest = comments.at(-1)?.body ?? 'No field notes yet.';
    return `${incident.severity} · ${incident.status.toUpperCase()} — ${incident.title}. ${completed}/${tasks.length} tasks complete. Latest note: ${latest}`;
  },
});

async function record(
  ctx: any,
  input: {
    incidentId: any;
    actorId: string;
    kind: string;
    detail: string;
    now: number;
  },
) {
  await ctx.db.insert('activity', {
    incidentId: input.incidentId,
    actorId: input.actorId,
    kind: input.kind,
    detail: input.detail,
    createdAt: input.now,
  });
}

export const create = mutation({
  args: { actorId: v.string(), title: v.string(), severity: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const title = clean(args.title, 'incident title');
    const id = await ctx.db.insert('incidents', {
      slug: `incident-${args.now}`,
      title,
      summary: 'Investigation started. Add tasks and field notes as evidence arrives.',
      searchText: `${title} ${args.severity} investigating`,
      severity: args.severity,
      status: 'investigating',
      commanderId: args.actorId,
      createdAt: args.now,
      updatedAt: args.now,
    });
    await record(ctx, {
      incidentId: id,
      actorId: args.actorId,
      kind: 'incident.created',
      detail: `${args.severity} incident opened`,
      now: args.now,
    });
    return String(id);
  },
});

export const addTask = mutation({
  args: { actorId: v.string(), incidentId, body: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const body = clean(args.body, 'task');
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_incident_position', (q) => q.eq('incidentId', args.incidentId))
      .collect();
    await ctx.db.insert('tasks', {
      incidentId: args.incidentId,
      body,
      completed: false,
      assigneeId: args.actorId,
      position: tasks.length + 1,
      createdAt: args.now,
    });
    await ctx.db.patch(args.incidentId, { updatedAt: args.now });
    await record(ctx, {
      incidentId: args.incidentId,
      actorId: args.actorId,
      kind: 'task.added',
      detail: body,
      now: args.now,
    });
  },
});

export const toggleTask = mutation({
  args: {
    actorId: v.string(),
    incidentId,
    taskId: v.id('tasks'),
    completed: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.incidentId !== args.incidentId) throw new Error('task not found');
    await ctx.db.patch(args.taskId, { completed: args.completed });
    await ctx.db.patch(args.incidentId, { updatedAt: args.now });
    await record(ctx, {
      incidentId: args.incidentId,
      actorId: args.actorId,
      kind: args.completed ? 'task.completed' : 'task.reopened',
      detail: task.body,
      now: args.now,
    });
  },
});

export const addComment = mutation({
  args: { actorId: v.string(), incidentId, body: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const body = clean(args.body, 'comment');
    await ctx.db.insert('comments', {
      incidentId: args.incidentId,
      authorId: args.actorId,
      body,
      createdAt: args.now,
    });
    await ctx.db.patch(args.incidentId, { updatedAt: args.now });
    await record(ctx, {
      incidentId: args.incidentId,
      actorId: args.actorId,
      kind: 'comment.added',
      detail: body.slice(0, 80),
      now: args.now,
    });
  },
});

export const setStatus = mutation({
  args: { actorId: v.string(), incidentId, status: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error('incident not found');
    await ctx.db.patch(args.incidentId, {
      status: args.status,
      searchText: `${incident.title} ${incident.summary} ${incident.severity} ${args.status}`,
      updatedAt: args.now,
    });
    await record(ctx, {
      incidentId: args.incidentId,
      actorId: args.actorId,
      kind: 'incident.status',
      detail: `${incident.status} → ${args.status}`,
      now: args.now,
    });
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query('incidents').first()) return { seeded: false };
    const api = await ctx.db.insert('incidents', {
      slug: 'incident-api',
      title: 'Checkout API latency',
      summary: 'p95 latency rose after the catalog deploy; checkout remains available.',
      searchText: 'Checkout API latency p95 catalog SEV-2 investigating',
      severity: 'SEV-2',
      status: 'investigating',
      commanderId: 'user_ada',
      createdAt: 1785157200000,
      updatedAt: 1785159000000,
    });
    const email = await ctx.db.insert('incidents', {
      slug: 'incident-email',
      title: 'Receipt email backlog',
      summary: 'Transactional receipts are delayed in the west region.',
      searchText: 'Receipt email backlog delayed west SEV-3 monitoring',
      severity: 'SEV-3',
      status: 'monitoring',
      commanderId: 'user_grace',
      createdAt: 1785146400000,
      updatedAt: 1785155400000,
    });
    for (const row of [
      {
        incidentId: api,
        body: 'Compare traces before and after deploy',
        completed: true,
        assigneeId: 'user_ada',
        position: 1,
        createdAt: 1785157260000,
      },
      {
        incidentId: api,
        body: 'Verify catalog cache hit rate',
        completed: false,
        assigneeId: 'user_lin',
        position: 2,
        createdAt: 1785157320000,
      },
      {
        incidentId: email,
        body: 'Drain delayed receipt queue',
        completed: true,
        assigneeId: 'user_grace',
        position: 1,
        createdAt: 1785146460000,
      },
    ]) await ctx.db.insert('tasks', row);
    await ctx.db.insert('comments', {
      incidentId: api,
      authorId: 'user_lin',
      body: 'Database time is flat; catalog calls account for most of the regression.',
      createdAt: 1785157800000,
    });
    await ctx.db.insert('comments', {
      incidentId: email,
      authorId: 'user_grace',
      body: 'Backlog is shrinking and no messages have failed permanently.',
      createdAt: 1785151800000,
    });
    await record(ctx, {
      incidentId: api,
      actorId: 'user_ada',
      kind: 'incident.created',
      detail: 'SEV-2 incident opened',
      now: 1785157200000,
    });
    await record(ctx, {
      incidentId: email,
      actorId: 'user_grace',
      kind: 'incident.status',
      detail: 'investigating → monitoring',
      now: 1785155400000,
    });
    return { seeded: true };
  },
});

export const heartbeat = mutation({
  args: {
    connectionId: v.string(),
    incidentId,
    userId: v.string(),
    name: v.string(),
    color: v.string(),
    viewing: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const stale = await ctx.db.query('presence').collect();
    for (const row of stale) {
      if (row.updatedAt < args.now - 20_000) await ctx.db.delete(row._id);
    }
    const existing = await ctx.db
      .query('presence')
      .withIndex('by_connection', (q) => q.eq('connectionId', args.connectionId))
      .unique();
    const value = {
      incidentId: args.incidentId,
      userId: args.userId,
      name: args.name,
      color: args.color,
      viewing: args.viewing,
      updatedAt: args.now,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('presence', { connectionId: args.connectionId, ...value });
  },
});

export const leavePresence = mutation({
  args: { connectionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('presence')
      .withIndex('by_connection', (q) => q.eq('connectionId', args.connectionId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const presence = query({
  args: { incidentId, after: v.number() },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query('presence')
        .withIndex('by_incident', (q) => q.eq('incidentId', args.incidentId))
        .collect()
    )
      .filter((row) => row.updatedAt >= args.after)
      .map((row) => ({ ...row, key: row.connectionId, incidentId: String(row.incidentId) })),
});
