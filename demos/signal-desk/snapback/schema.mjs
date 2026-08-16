// Signal Desk: one durable collaboration model plus a deliberately ephemeral
// viewer-presence lane.
// @ref LLP 0063#next-application-pressure-tests — the tracker-shaped slice
// pressures transactions, filters, history, live collaboration, and presence.

import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

export const incidents = defineTable({
  title: v.string(),
  summary: v.string(),
  severity: v.string(),
  status: v.string(),
  commanderId: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_updated', ['updatedAt'])
  .searchIndex('search_incidents', {
    semanticVersion: 'signal-desk-incidents.v1',
    textFields: {
      title: { weight: 8, classification: 'public' },
      summary: { weight: 4, classification: 'public' },
      severity: { weight: 2, classification: 'public' },
      status: { weight: 2, classification: 'public' },
    },
    fieldClassifications: {
      commanderId: 'public',
      createdAt: 'public',
      updatedAt: 'public',
    },
    equalityFilters: ['severity', 'status'],
    storedFields: [
      'commanderId',
      'createdAt',
      'severity',
      'status',
      'summary',
      'title',
      'updatedAt',
    ],
    highlightFields: ['summary', 'title'],
    visibility: { kind: 'public-read' },
  })
  .sync();

export const tasks = defineTable({
  incidentId: v.id('incidents'),
  incidentIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'incidentId',
    parentTable: 'incidents',
  }),
  body: v.string(),
  completed: v.boolean(),
  assigneeId: v.string(),
  position: v.integer(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_incident_position', ['incidentId', 'incidentIncarnation', 'position'])
  .sync();

export const comments = defineTable({
  incidentId: v.id('incidents'),
  incidentIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'incidentId',
    parentTable: 'incidents',
  }),
  authorId: v.string(),
  body: v.string(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_incident_created', ['incidentId', 'incidentIncarnation', 'createdAt'])
  .sync();

export const activity = defineTable({
  incidentId: v.id('incidents'),
  incidentIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'incidentId',
    parentTable: 'incidents',
  }),
  actorId: v.string(),
  sourceTable: v.string(),
  sourceId: v.string(),
  operation: v.string(),
  effectiveSubject: v.string(),
  actualActor: v.string(),
  actorKind: v.string(),
  grantId: v.optional(v.string()),
  mutationDigest: v.string(),
  kind: v.string(),
  detail: v.string(),
  createdAt: v.integer(),
  sortKey: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_incident_created', ['incidentId', 'createdAt'])
  .index('by_incident_sort_key', ['incidentId', 'incidentIncarnation', 'sortKey'])
  .sync();

export default defineSchema(
  {
    incidents,
    tasks,
    comments,
    activity,
  },
  {
    auth: { mode: 'sessions' },
    ephemeral: defineEphemeral({
      incidentPresence: ephemeral.collection({
        scope: { incidentId: v.string() },
        routing: ['incidentId'],
        key: 'connection',
        ttlMs: 12_000,
        maxTtlMs: 30_000,
        maxValueBytes: 512,
        publishRate: { sustainedHz: 2, burst: 6 },
        delivery: { mode: 'latest', dispatchMs: 100 },
        value: v.object({
          userId: v.string(),
          name: v.string(),
          color: v.string(),
          viewing: v.string(),
        }),
        publish: allow.all(),
        subscribe: allow.all(),
      }),
    }),
  },
);
