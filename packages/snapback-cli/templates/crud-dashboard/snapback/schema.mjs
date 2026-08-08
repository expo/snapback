import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const teams = defineTable({
  slug: v.string(),
  name: v.string(),
  color: v.string(),
}).index('by_slug', ['slug'], { unique: true }).sync();

export const projects = defineTable({
  projectKey: v.string(),
  teamSlug: v.string(),
  title: v.string(),
  summary: v.string(),
  status: v.string(),
  budget: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_updated', ['updatedAt'])
  .index('by_key', ['projectKey'], { unique: true })
  .index('by_team_updated', ['teamSlug', 'updatedAt'])
  .sync();

export default defineSchema({ teams, projects }, {
  // Sessions is the starter default even though this public sample dataset
  // deliberately keeps its CRUD calls usable from an anonymous web preview.
  auth: { mode: 'sessions' },
});
