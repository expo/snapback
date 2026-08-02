import {
  arg,
  asc,
  authUserId,
  defineAction,
  defineAssetUpload,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineLiveQuery,
  defineMutation,
  defineSearchQuery,
  eq,
  get,
  guard,
  lit,
  mutationPlan,
  patch,
  record,
  results,
  returnExpr,
  runMutation,
  runtimeNow,
  v,
} from '@expo/snapback-codegen/define';
import { incidents } from './schema.mjs';

export const listIncidents = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  reads: ['incidentAccess', 'incidents'],
  result: results.documents('incidents'),
  handler: async (ctx) => {
    const access = await ctx.db.query('incidentAccess').withIndex('by_user').eq('userId', ctx.auth.userId).collect();
    const rows = [];
    for (const grant of access) {
      const incident = await ctx.db.get('incidents', grant.incidentId);
      if (incident) rows.push(incident);
    }
    return rows.sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const messagesForIncident = defineLiveQuery({
  auth: 'authenticated',
  table: 'messages',
  args: { incidentId: v.id('incidents') },
  filter: [eq('incidentId', arg('incidentId'))],
  order: [asc('_createdAt')],
  index: 'by_incident',
});

export const activityForIncident = defineLiveQuery({
  auth: 'authenticated',
  table: 'activity',
  args: { incidentId: v.id('incidents') },
  filter: [eq('incidentId', arg('incidentId'))],
  order: [asc('_createdAt')],
  index: 'by_incident',
});

export const maintenanceStatus = defineLiveQuery({
  auth: 'authenticated',
  table: 'maintenance',
  args: {},
  order: [asc('name')],
  index: 'by_name',
});

export const createMessage = defineJsMutation({
  auth: 'authenticated',
  args: { incidentId: v.id('incidents'), authorName: v.string(), body: v.string() },
  reads: ['incidentAccess'],
  writes: ['messages'],
  result: results.value(v.id('messages')),
  handler: async (ctx, args) => {
    const access = await ctx.db.query('incidentAccess').withIndex('by_incident').eq('incidentId', args.incidentId).collect();
    if (!access.some((row) => row.userId === ctx.auth.userId)) throw new Error('incident access denied');
    return await ctx.db.insert('messages', {
      incidentId: args.incidentId,
      authorId: ctx.auth.userId,
      authorName: args.authorName,
      body: args.body.trim(),
      kind: 'message',
    });
  },
});

export const acknowledgeIncident = defineJsMutation({
  auth: 'authenticated',
  args: { incidentId: v.id('incidents') },
  reads: ['incidentAccess', 'incidents'],
  writes: ['incidents', 'activity'],
  result: results.document('incidents'),
  handler: async (ctx, args) => {
    const access = await ctx.db.query('incidentAccess').withIndex('by_incident').eq('incidentId', args.incidentId).collect();
    if (!access.some((row) => row.userId === ctx.auth.userId)) throw new Error('incident access denied');
    await ctx.db.patch('incidents', args.incidentId, { status: 'acknowledged' });
    await ctx.db.insert('activity', { incidentId: args.incidentId, actorId: ctx.auth.userId, action: 'acknowledged' });
    return await ctx.db.get('incidents', args.incidentId);
  },
});

export const incidentAttachment = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: [],
  accept: { mediaTypes: ['text/plain', 'image/png', 'image/jpeg'], maxBytes: 5_242_880 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const attachIncidentFile = defineJsMutation({
  auth: 'authenticated',
  args: { incidentId: v.id('incidents'), assetId: v.string() },
  reads: ['incidentAccess'],
  writes: ['incidents'],
  result: results.document('incidents'),
  handler: async (ctx, args) => {
    const access = await ctx.db.query('incidentAccess').withIndex('by_incident').eq('incidentId', args.incidentId).collect();
    if (!access.some((row) => row.userId === ctx.auth.userId)) throw new Error('incident access denied');
    await ctx.db.patch('incidents', args.incidentId, {
      attachment: await ctx.assets.attach(args.assetId, { upload: 'incidentAttachment' }),
    });
    return await ctx.db.get('incidents', args.incidentId);
  },
});

export const searchIncidents = defineSearchQuery({ table: incidents, index: 'search_incidents', auth: 'authenticated' });

export const recordMaintenance = defineJsMutation({
  args: {},
  reads: ['maintenance'],
  writes: ['maintenance'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx) => {
    const row = await ctx.db.get('maintenance', 'maintenance_hourly');
    if (!row) throw new Error('maintenance row missing');
    await ctx.db.patch('maintenance', row._id, { runCount: row.runCount + 1, lastRunAt: ctx.runtime.now() });
    return { ok: true };
  },
});

export const runMaintenance = defineAction({
  args: {},
  writes: ['maintenance'],
  result: results.value(v.object({ ok: v.boolean() })),
  handler: async (ctx) => ctx.runMutation('recordMaintenance', {}),
});

export const maintenanceCron = defineCron({
  hourlyMaintenance: {
    schedule: { cron: '0 * * * *' },
    action: 'runMaintenance',
    enabled: true,
    jitter: true,
  },
});
