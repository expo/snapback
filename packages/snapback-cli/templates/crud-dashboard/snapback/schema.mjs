import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// @ref LLP 0234#phase-g2--d2-enforcing-closure — the dashboard is a shared
// public sample: its anonymous directory and CRUD functions serve every row.
export const teams = defineTable({
  slug: v.string(),
  name: v.string(),
  color: v.string(),
}).visibility({ kind: 'public-read' }).index('by_slug', ['slug'], { unique: true }).sync();

export const projects = defineTable({
  projectKey: v.string(),
  teamSlug: v.string(),
  title: v.string(),
  summary: v.string(),
  status: v.string(),
  budget: v.integer(),
  updatedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_updated', ['updatedAt'])
  .index('by_key', ['projectKey'], { unique: true })
  .index('by_team_updated', ['teamSlug', 'updatedAt'])
  .sync();

export default defineSchema({ teams, projects }, {
  // Sessions is the starter default even though this public sample dataset
  // deliberately keeps its CRUD calls usable from an anonymous web preview.
  auth: { mode: 'sessions' },
});
