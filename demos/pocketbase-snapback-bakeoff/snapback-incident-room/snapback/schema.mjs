import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

export const rooms = defineTable({
  name: v.string(),
  ownerId: v.principal(),
}).index('by_owner', ['ownerId']).sync();

export const incidentAccess = defineTable({
  incidentId: v.id('incidents'),
  userId: v.principal(),
  role: v.string(),
}).index('by_user', ['userId']).index('by_incident', ['incidentId']).sync();

export const incidents = defineTable({
  roomId: v.id('rooms'),
  title: v.string(),
  summary: v.string(),
  severity: v.string(),
  status: v.string(),
  commanderId: v.principal(),
  attachment: v.optional(v.assetRef({ upload: 'incidentAttachment' })),
})
  .index('by_room', ['roomId'])
  .index('by_commander', ['commanderId'])
  .searchIndex('search_incidents', {
    semanticVersion: 'incident-room.v1',
    textFields: {
      title: { weight: 8, classification: 'private' },
      summary: { weight: 4, classification: 'private' },
      severity: { weight: 2, classification: 'private' },
      status: { weight: 2, classification: 'private' },
    },
    fieldClassifications: { commanderId: 'private' },
    equalityFilters: ['severity', 'status'],
    storedFields: ['commanderId', 'severity', 'status', 'summary', 'title'],
    highlightFields: ['summary', 'title'],
    visibility: { kind: 'owner', field: 'commanderId' },
  })
  .assetSharing({ kind: 'owner', field: 'commanderId' })
  .sync();

export const messages = defineTable({
  incidentId: v.id('incidents'),
  authorId: v.principal(),
  authorName: v.string(),
  body: v.string(),
  kind: v.string(),
}).index('by_incident', ['incidentId']).sync();

export const activity = defineTable({
  incidentId: v.id('incidents'),
  actorId: v.principal(),
  action: v.string(),
}).index('by_incident', ['incidentId']).sync();

export const maintenance = defineTable({
  name: v.string(),
  runCount: v.integer(),
  lastRunAt: v.integer(),
}).index('by_name', ['name']).sync();

export default defineSchema({ rooms, incidentAccess, incidents, messages, activity, maintenance }, {
  auth: { mode: 'dev' },
  ephemeral: defineEphemeral({
    incidentPresence: ephemeral.collection({
      scope: { incidentId: v.string() },
      routing: ['incidentId'],
      key: 'connection',
      ttlMs: 10_000,
      maxTtlMs: 20_000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 4, burst: 8 },
      delivery: { mode: 'latest', dispatchMs: 50 },
      value: v.object({ name: v.string(), state: v.string() }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
