import {
  arg,
  asc,
  authUserId,
  binding,
  bindingRef,
  clientMutation,
  defineMutation,
  defineBoundedChildrenQuery,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  defineSearchQuery,
  defineWriteWithActivity,
  del,
  desc,
  eq,
  eqv,
  existingOwner,
  field,
  get,
  guard,
  insert,
  literal,
  mutationPlan,
  results,
  owner,
  patch,
  record,
  returnLiteral,
  runtimeNow,
  throughParent,
  throughScope,
  v,
} from '@snapback/codegen/define';
import { activity, comments, incidents, tasks } from './schema.mjs';

export const listIncidents = defineLiveQuery({
  table: 'incidents',
  args: {},
  order: [desc('updatedAt')],
  index: 'by_updated',
});

export const listTasks = defineLiveQuery({
  table: 'tasks',
  args: { incidentId: v.id('incidents') },
  filter: [eq('incidentId', arg('incidentId'))],
  order: [asc('position')],
  index: 'by_incident_position',
});

export const listComments = defineLiveQuery({
  table: 'comments',
  args: { incidentId: v.id('incidents') },
  filter: [eq('incidentId', arg('incidentId'))],
  order: [asc('createdAt')],
  index: 'by_incident_created',
});

export const listActivity = defineLiveQuery({
  table: 'activity',
  args: { incidentId: v.id('incidents') },
  filter: [eq('incidentId', arg('incidentId'))],
  order: [desc('createdAt')],
  index: 'by_incident_created',
});

export const incidentTasks = defineBoundedChildrenQuery({
  parent: {
    table: incidents,
    idArg: 'incidentId',
    visibility: owner('commanderId'),
    select: { id: '_id', title: 'title', updatedAt: 'updatedAt' },
  },
  children: {
    table: tasks,
    foreignKey: 'incidentId',
    parentIncarnation: 'incidentIncarnation',
    visibility: throughParent(),
    index: 'by_incident_position',
    order: [asc('position')],
    select: {
      id: '_id',
      body: 'body',
      completed: 'completed',
      assigneeId: 'assigneeId',
      position: 'position',
      createdAt: 'createdAt',
    },
  },
  take: 2,
  parentDeletion: 'hide-orphans.v1',
});

export const incidentComments = defineBoundedChildrenQuery({
  parent: {
    table: incidents,
    idArg: 'incidentId',
    visibility: owner('commanderId'),
    select: { id: '_id', title: 'title', updatedAt: 'updatedAt' },
  },
  children: {
    table: comments,
    foreignKey: 'incidentId',
    parentIncarnation: 'incidentIncarnation',
    visibility: throughParent(),
    index: 'by_incident_created',
    order: [asc('createdAt')],
    select: { id: '_id', authorId: 'authorId', body: 'body', createdAt: 'createdAt' },
  },
  take: 100,
  parentDeletion: 'hide-orphans.v1',
});

export const incidentActivity = defineBoundedChildrenQuery({
  parent: {
    table: incidents,
    idArg: 'incidentId',
    visibility: owner('commanderId'),
    select: { id: '_id', title: 'title', updatedAt: 'updatedAt' },
  },
  children: {
    table: activity,
    foreignKey: 'incidentId',
    parentIncarnation: 'incidentIncarnation',
    visibility: throughParent(),
    index: 'by_incident_sort_key',
    order: [asc('sortKey')],
    select: {
      id: '_id',
      actorId: 'actorId',
      kind: 'kind',
      detail: 'detail',
      createdAt: 'createdAt',
      sortKey: 'sortKey',
    },
  },
  take: 100,
  parentDeletion: 'hide-orphans.v1',
});

// The comparison UI intentionally keeps one backend-neutral subscription
// contract. These all-row feeds are a deliberate pressure point: the diary
// counts the extra fan-out and client-side grouping against each adapter.
export const allTasks = defineLiveQuery({ table: 'tasks', args: {} });
export const allComments = defineLiveQuery({ table: 'comments', args: {} });
export const allActivity = defineLiveQuery({ table: 'activity', args: {} });

export const createIncident = defineJsMutation({
  args: {
    title: v.string(),
    severity: v.string(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('incidents')),
  writes: ['incidents', 'activity'],
  handler: async (ctx, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('incident title is required');
    if (!new Set(['SEV-1', 'SEV-2', 'SEV-3']).has(args.severity)) {
      throw new Error('invalid severity');
    }
    const incidentId = await ctx.db.insert('incidents', {
      title,
      summary: 'Investigation started. Add tasks and field notes as evidence arrives.',
      severity: args.severity,
      status: 'investigating',
      commanderId: args.actorId,
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.insert('activity', {
      incidentId,
      actorId: args.actorId,
      sourceTable: 'incidents',
      sourceId: incidentId,
      operation: 'insert',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: 'incident.created',
      detail: `${args.severity} incident opened`,
      createdAt: args.now,
      sortKey: args.now,
    });
    return incidentId;
  },
});

export const addTask = defineJsMutation({
  args: {
    incidentId: v.id('incidents'),
    body: v.string(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('tasks')),
  reads: ['incidents', 'tasks'],
  writes: ['incidents', 'tasks', 'activity'],
  handler: async (ctx, args) => {
    const body = String(args.body ?? '').trim();
    if (!body) throw new Error('task is required');
    const incident = await ctx.db.get('incidents', args.incidentId);
    if (!incident) throw new Error('incident not found');
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_incident_position')
      .eq('incidentId', args.incidentId)
      .collect();
    const taskId = await ctx.db.insert('tasks', {
      incidentId: args.incidentId,
      body,
      completed: false,
      assigneeId: args.actorId,
      position: tasks.length + 1,
      createdAt: args.now,
    });
    await ctx.db.patch('incidents', args.incidentId, { updatedAt: args.now });
    await ctx.db.insert('activity', {
      incidentId: args.incidentId,
      actorId: args.actorId,
      sourceTable: 'tasks',
      sourceId: taskId,
      operation: 'insert',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: 'task.added',
      detail: body,
      createdAt: args.now,
      sortKey: args.now,
    });
    return taskId;
  },
});

// Review-gated LLP 0104 proving declaration. The bakeoff's dev-impersonation
// transport intentionally keeps using the explicit handler until the reviewed
// profile has a provenance-bearing non-dev authority in this fixture.
export const addTaskWithActivity = defineWriteWithActivity({
  args: {
    incidentId: v.id('incidents'),
    body: v.string(),
    actorId: v.string(),
  },
  scope: existingOwner({
    table: incidents,
    id: arg('incidentId'),
    visibility: owner('commanderId'),
  }),
  primary: mutationPlan(insert('tasks', {
    incidentId: arg('incidentId'),
    body: arg('body'),
    completed: literal(false),
    assigneeId: arg('actorId'),
    position: runtimeNow(),
    createdAt: runtimeNow(),
  }, { bindIdAs: 'taskId' })),
  source: { table: tasks, id: binding('taskId') },
  activity: {
    table: activity,
    visibility: throughScope({
      scopeField: 'incidentId',
      scopeIncarnationField: 'incidentIncarnation',
    }),
    provenance: {
      scopeId: 'incidentId',
      sourceTable: 'sourceTable',
      sourceId: 'sourceId',
      operation: 'operation',
      effectiveSubject: 'effectiveSubject',
      actualActor: 'actualActor',
      actorKind: 'actorKind',
      grant: 'grantId',
      occurredAt: 'createdAt',
      mutation: 'mutationDigest',
    },
    values: {
      actorId: arg('actorId'),
      kind: literal('task.added'),
      detail: arg('body'),
      sortKey: runtimeNow(),
    },
  },
  idempotency: clientMutation(),
  result: results.value(v.object({
    taskId: v.id('tasks'),
    activityId: v.id('activity'),
  })),
  returns: record({
    taskId: binding('taskId'),
    activityId: binding('__activityId'),
  }),
});

// Acceptance-only closed profile for proving storage-equal patch refusal and
// exact replay. The product adapter keeps its backend-neutral toggle contract.
export const toggleTaskWithActivity = defineWriteWithActivity({
  args: {
    incidentId: v.id('incidents'),
    taskId: v.id('tasks'),
    completed: v.boolean(),
    actorId: v.string(),
  },
  scope: existingOwner({
    table: incidents,
    id: arg('incidentId'),
    visibility: owner('commanderId'),
  }),
  primary: mutationPlan(
    get('tasks', arg('taskId'), 'task', { elseError: 'SNAPBACK_ROW_NOT_FOUND' }),
    guard(
      eqv(field(bindingRef('task'), 'incidentId'), arg('incidentId')),
      'SNAPBACK_ROW_NOT_FOUND',
    ),
    patch('tasks', arg('taskId'), { completed: arg('completed') }),
  ),
  source: { table: tasks, id: arg('taskId') },
  activity: {
    table: activity,
    visibility: throughScope({
      scopeField: 'incidentId',
      scopeIncarnationField: 'incidentIncarnation',
    }),
    provenance: {
      scopeId: 'incidentId',
      sourceTable: 'sourceTable',
      sourceId: 'sourceId',
      operation: 'operation',
      effectiveSubject: 'effectiveSubject',
      actualActor: 'actualActor',
      actorKind: 'actorKind',
      grant: 'grantId',
      occurredAt: 'createdAt',
      mutation: 'mutationDigest',
    },
    values: {
      actorId: arg('actorId'),
      kind: literal('task.toggled'),
      detail: literal('acceptance profile'),
      sortKey: runtimeNow(),
    },
  },
  idempotency: clientMutation(),
  result: results.value(v.object({
    taskId: v.id('tasks'),
    activityId: v.id('activity'),
  })),
  returns: record({
    taskId: arg('taskId'),
    activityId: binding('__activityId'),
  }),
});

// Acceptance-only owner-checked delete leaves children orphaned so the
// bounded profile can prove that an inactive parent collapses to `absent`.
export const deleteIncidentForAcceptance = defineMutation({
  args: { incidentId: v.id('incidents') },
  auth: 'authenticated',
  result: results.value(v.boolean()),
  plan: [
    get('incidents', arg('incidentId'), 'incident', {
      elseError: 'SNAPBACK_ROW_NOT_FOUND',
    }),
    guard(
      eqv(field(bindingRef('incident'), 'commanderId'), authUserId()),
      'SNAPBACK_ROW_NOT_FOUND',
    ),
    del('incidents', arg('incidentId')),
  ],
  returns: returnLiteral(true),
});

export const toggleTask = defineJsMutation({
  args: {
    incidentId: v.id('incidents'),
    taskId: v.id('tasks'),
    completed: v.boolean(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('tasks')),
  reads: ['tasks'],
  writes: ['incidents', 'tasks', 'activity'],
  handler: async (ctx, args) => {
    const task = await ctx.db.get('tasks', args.taskId);
    if (!task || task.incidentId !== args.incidentId) throw new Error('task not found');
    await ctx.db.patch('tasks', args.taskId, { completed: args.completed });
    await ctx.db.patch('incidents', args.incidentId, { updatedAt: args.now });
    await ctx.db.insert('activity', {
      incidentId: args.incidentId,
      actorId: args.actorId,
      sourceTable: 'tasks',
      sourceId: args.taskId,
      operation: 'patch',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: args.completed ? 'task.completed' : 'task.reopened',
      detail: task.body,
      createdAt: args.now,
      sortKey: args.now,
    });
    return args.taskId;
  },
});

export const addComment = defineJsMutation({
  args: {
    incidentId: v.id('incidents'),
    body: v.string(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('comments')),
  writes: ['incidents', 'comments', 'activity'],
  handler: async (ctx, args) => {
    const body = String(args.body ?? '').trim();
    if (!body) throw new Error('comment is required');
    const commentId = await ctx.db.insert('comments', {
      incidentId: args.incidentId,
      authorId: args.actorId,
      body,
      createdAt: args.now,
    });
    await ctx.db.patch('incidents', args.incidentId, { updatedAt: args.now });
    await ctx.db.insert('activity', {
      incidentId: args.incidentId,
      actorId: args.actorId,
      sourceTable: 'comments',
      sourceId: commentId,
      operation: 'insert',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: 'comment.added',
      detail: body.slice(0, 80),
      createdAt: args.now,
      sortKey: args.now,
    });
    return commentId;
  },
});

export const setStatus = defineJsMutation({
  args: {
    incidentId: v.id('incidents'),
    status: v.string(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.string()),
  reads: ['incidents'],
  writes: ['incidents', 'activity'],
  handler: async (ctx, args) => {
    if (!new Set(['investigating', 'monitoring', 'resolved']).has(args.status)) {
      throw new Error('invalid incident status');
    }
    const incident = await ctx.db.get('incidents', args.incidentId);
    if (!incident) throw new Error('incident not found');
    await ctx.db.patch('incidents', args.incidentId, {
      status: args.status,
      updatedAt: args.now,
    });
    await ctx.db.insert('activity', {
      incidentId: args.incidentId,
      actorId: args.actorId,
      sourceTable: 'incidents',
      sourceId: args.incidentId,
      operation: 'patch',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: 'incident.status',
      detail: `${incident.status} → ${args.status}`,
      createdAt: args.now,
      sortKey: args.now,
    });
    return args.status;
  },
});

export const searchIncidents = defineSearchQuery({
  table: incidents,
  index: 'search_incidents',
});

export const generateBrief = defineJsQuery({
  args: { incidentId: v.id('incidents') },
  result: results.records(v.object({ brief: v.string() })),
  reads: ['incidents', 'tasks', 'comments', 'activity'],
  handler: async (ctx, args) => {
    const incident = await ctx.db.get('incidents', args.incidentId);
    if (!incident) throw new Error('incident not found');
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_incident_position')
      .eq('incidentId', args.incidentId)
      .collect();
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_incident_created')
      .eq('incidentId', args.incidentId)
      .collect();
    const completed = tasks.filter((task) => task.completed).length;
    const latest = comments.at(-1)?.body ?? 'No field notes yet.';
    return [{
      brief: `${incident.severity} · ${incident.status.toUpperCase()} — ${incident.title}. ${completed}/${tasks.length} tasks complete. Latest note: ${latest}`,
    }];
  },
});
