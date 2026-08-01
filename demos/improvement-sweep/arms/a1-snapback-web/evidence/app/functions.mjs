import {
  asc,
  defineAssetUpload,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

// Field-report attachments: plain text or PDF, private-strict delivery so
// every byte read re-authorizes through the membership assetSharing on
// recordAttachments. (Declared here, not in schema.mjs: an intent exported
// from the schema module is silently ignored by 0.1.7 codegen.)
export const recordAttachment = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['records'],
  accept: { mediaTypes: ['text/plain', 'application/pdf'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// ---- membership guard ----

async function requireWorkspaceRole(ctx, workspaceId) {
  await ctx.permissions.workspaceMembers.requireRole(workspaceId, 'host', 'member');
}

// ---- public reference data (authority-independent, rqsEligible) ----

// The three flags below are the retainability opt-in: without ALL of
// auth:'public' + authorityIndependent + retainable, a sessions-mode
// subscription is authority-scoped and the server mints no resume token, so
// the JS arm's cold-boot retained render never engages. Learned from
// packaged define.mjs bytes — the offline guide page says "authority-
// independent live queries" retain but never shows this declaration.
export const listSites = defineLiveQuery({
  table: 'sites',
  args: {},
  order: [asc('name')],
  index: 'by_name',
  auth: 'public',
  authorityIndependent: true,
  retainable: true,
});

// ---- workspace lifecycle ----

export const createWorkspace = defineJsMutation({
  args: { name: v.string() },
  writes: ['workspaces', 'workspaceMembers'],
  authorityCreating: false,
  result: results.value(v.id('workspaces')),
  handler: async (ctx, args) => {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('workspace name is required');
    return await ctx.membership.workspaceMembers.bootstrap({ name });
  },
});

export const inviteToWorkspace = defineJsMutation({
  args: { workspaceId: v.id('workspaces'), userId: v.principal() },
  writes: ['workspaceMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.workspaceMembers.insert({
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: 'invited',
    });
    return true;
  },
});

export const acceptWorkspaceInvite = defineJsMutation({
  args: { workspaceId: v.id('workspaces') },
  writes: ['workspaceMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.workspaceMembers.setSelfRole(args.workspaceId, 'member');
    return true;
  },
});

export const leaveWorkspace = defineJsMutation({
  args: { workspaceId: v.id('workspaces') },
  writes: ['workspaceMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.workspaceMembers.removeSelf(args.workspaceId);
    return true;
  },
});

// ---- records ----

function sortRecords(rows) {
  rows.sort((a, b) =>
    a.position - b.position || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
  return rows;
}

// Protected live view: JS handler with requireRole, so an outsider gets the
// uniform SNAPBACK_AUTH_PERMISSION_DENIED refusal. (The declarative
// `membership: [workspaceMembers.hasRole(membershipResource.arg(...), ...)]`
// alternative silently uses FILTER semantics instead: a non-member's query
// resolves with zero rows rather than a denial — no disclosure, but a
// surprising split between the two membership idioms; recorded as an arm
// finding.) Deliberately auth-scoped, so the JS arm's retention boundary
// applies (A1-06 observes the exact refusal fact on this handle).
export const listRecords = defineJsLiveQuery({
  args: { workspaceId: v.id('workspaces') },
  reads: ['records', 'workspaces', 'workspaceMembers'],
  result: results.documents('records'),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    const rows = await ctx.db
      .query('records')
      .withIndex('by_workspace')
      .eq('workspaceId', args.workspaceId)
      .collect();
    return sortRecords(rows);
  },
});

// Idempotent create: (workspaceId, clientKey) is unique; a replayed or
// retried create finds the committed row and returns its id (changed_count 0).
export const createRecord = defineJsMutation({
  args: {
    workspaceId: v.id('workspaces'),
    title: v.string(),
    assigneeId: v.principal(),
    assigneeName: v.string(),
    dueAt: v.integer(),
    position: v.integer(),
    clientKey: v.string(),
  },
  writes: ['records'],
  result: results.value(v.id('records')),
  handler: async (ctx, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('record title is required');
    await requireWorkspaceRole(ctx, args.workspaceId);
    const existing = await ctx.db
      .query('records')
      .withIndex('by_workspace_client_key')
      .eq('workspaceId', args.workspaceId)
      .eq('clientKey', args.clientKey)
      .collect();
    if (existing.length > 0) return existing[0]._id;
    return await ctx.db.insert('records', {
      workspaceId: args.workspaceId,
      title,
      notes: '',
      assigneeId: args.assigneeId,
      assigneeName: String(args.assigneeName ?? ''),
      dueAt: args.dueAt,
      position: args.position,
      state: 'open',
      revision: 1,
      clientKey: args.clientKey,
    });
  },
});

// Field edit with visible conflict outcome: every edit bumps `revision`;
// concurrent edits settle in server commit order (last commit wins the
// field, both commits visible as distinct versions/revisions).
export const updateRecord = defineJsMutation({
  args: {
    recordId: v.id('records'),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    state: v.optional(v.string()),
  },
  writes: ['records'],
  reads: ['records', 'workspaces', 'workspaceMembers'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const record = await ctx.db.get('records', args.recordId);
    if (!record) throw new Error('record not found');
    await requireWorkspaceRole(ctx, record.workspaceId);
    const patch = { revision: record.revision + 1 };
    if (args.title !== undefined) patch.title = String(args.title).trim();
    if (args.notes !== undefined) patch.notes = String(args.notes);
    if (args.state !== undefined) {
      if (args.state !== 'open' && args.state !== 'done') throw new Error('invalid state');
      patch.state = args.state;
    }
    await ctx.db.patch('records', args.recordId, patch);
    return patch.revision;
  },
});

export const assignRecord = defineJsMutation({
  args: {
    recordId: v.id('records'),
    assigneeId: v.principal(),
    assigneeName: v.string(),
  },
  writes: ['records'],
  reads: ['records', 'workspaces', 'workspaceMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const record = await ctx.db.get('records', args.recordId);
    if (!record) throw new Error('record not found');
    await requireWorkspaceRole(ctx, record.workspaceId);
    await ctx.db.patch('records', args.recordId, {
      assigneeId: args.assigneeId,
      assigneeName: String(args.assigneeName ?? ''),
      revision: record.revision + 1,
    });
    return true;
  },
});

export const setDueDate = defineJsMutation({
  args: { recordId: v.id('records'), dueAt: v.integer() },
  writes: ['records'],
  reads: ['records', 'workspaces', 'workspaceMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const record = await ctx.db.get('records', args.recordId);
    if (!record) throw new Error('record not found');
    await requireWorkspaceRole(ctx, record.workspaceId);
    await ctx.db.patch('records', args.recordId, {
      dueAt: args.dueAt,
      revision: record.revision + 1,
    });
    return true;
  },
});

export const reorderRecord = defineJsMutation({
  args: { recordId: v.id('records'), position: v.integer() },
  writes: ['records'],
  reads: ['records', 'workspaces', 'workspaceMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const record = await ctx.db.get('records', args.recordId);
    if (!record) throw new Error('record not found');
    await requireWorkspaceRole(ctx, record.workspaceId);
    await ctx.db.patch('records', args.recordId, {
      position: args.position,
      revision: record.revision + 1,
    });
    return true;
  },
});

export const attachToRecord = defineJsMutation({
  args: { recordId: v.id('records'), assetId: v.string() },
  writes: ['records', 'recordAttachments'],
  reads: ['records', 'workspaces', 'workspaceMembers', 'recordAttachments'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const record = await ctx.db.get('records', args.recordId);
    if (!record) throw new Error('record not found');
    await requireWorkspaceRole(ctx, record.workspaceId);
    await ctx.db.insert('recordAttachments', {
      recordId: args.recordId,
      workspaceId: record.workspaceId,
      assetRef: await ctx.assets.attach(args.assetId, { upload: 'recordAttachment' }),
    });
    await ctx.db.patch('records', args.recordId, {
      attachmentAssetId: args.assetId,
      revision: record.revision + 1,
    });
    return true;
  },
});

export const detachFromRecord = defineJsMutation({
  args: { recordId: v.id('records') },
  writes: ['records', 'recordAttachments'],
  reads: ['records', 'workspaces', 'workspaceMembers', 'recordAttachments'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const record = await ctx.db.get('records', args.recordId);
    if (!record) throw new Error('record not found');
    await requireWorkspaceRole(ctx, record.workspaceId);
    const edges = await ctx.db
      .query('recordAttachments')
      .withIndex('by_record')
      .eq('recordId', args.recordId)
      .collect();
    for (const edge of edges) {
      await ctx.db.delete('recordAttachments', edge._id);
    }
    await ctx.db.patch('records', args.recordId, {
      attachmentAssetId: null,
      revision: record.revision + 1,
    });
    return true;
  },
});

// ---- deterministic export (A1-12) ----

export const exportWorkspace = defineJsQuery({
  args: { workspaceId: v.id('workspaces') },
  reads: ['records', 'workspaces'],
  result: results.records(v.object({ payload: v.string() })),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    const workspace = await ctx.db.get('workspaces', args.workspaceId);
    if (!workspace) throw new Error('workspace not found');
    const rows = sortRecords(await ctx.db
      .query('records')
      .withIndex('by_workspace')
      .eq('workspaceId', args.workspaceId)
      .collect());
    const doc = {
      formatVersion: 'a1-export.v1',
      workspace: { name: workspace.name },
      recordCount: rows.length,
      records: rows.map((row) => ({
        title: row.title,
        notes: row.notes,
        assigneeName: row.assigneeName,
        dueAt: row.dueAt,
        position: row.position,
        state: row.state,
        revision: row.revision,
        clientKey: row.clientKey,
        hasAttachment: row.attachmentAssetId !== null && row.attachmentAssetId !== undefined,
      })),
    };
    return [{ payload: JSON.stringify(doc) }];
  },
});
