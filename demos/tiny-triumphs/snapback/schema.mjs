import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const triumphs = defineTable({ text: v.string(), vibe: v.string(), createdAt: v.integer() })
  .index('by_created', ['createdAt'])
  .visibility({ kind: 'public-read' });

export default defineSchema({ triumphs });
