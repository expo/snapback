import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  incidents: defineTable({
    slug: v.string(),
    title: v.string(),
    summary: v.string(),
    searchText: v.string(),
    severity: v.string(),
    status: v.string(),
    commanderId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_updated', ['updatedAt'])
    .searchIndex('search_incidents', {
      searchField: 'searchText',
      filterFields: ['status', 'severity'],
    }),
  tasks: defineTable({
    incidentId: v.id('incidents'),
    body: v.string(),
    completed: v.boolean(),
    assigneeId: v.string(),
    position: v.number(),
    createdAt: v.number(),
  }).index('by_incident_position', ['incidentId', 'position']),
  comments: defineTable({
    incidentId: v.id('incidents'),
    authorId: v.string(),
    body: v.string(),
    createdAt: v.number(),
  }).index('by_incident_created', ['incidentId', 'createdAt']),
  activity: defineTable({
    incidentId: v.id('incidents'),
    actorId: v.string(),
    kind: v.string(),
    detail: v.string(),
    createdAt: v.number(),
  }).index('by_incident_created', ['incidentId', 'createdAt']),
  presence: defineTable({
    connectionId: v.string(),
    incidentId: v.id('incidents'),
    userId: v.string(),
    name: v.string(),
    color: v.string(),
    viewing: v.string(),
    updatedAt: v.number(),
  })
    .index('by_connection', ['connectionId'])
    .index('by_incident', ['incidentId']),
});
