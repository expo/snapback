// App-CLI served-journey fixture (LLP 0062 §5): the smallest sessions app
// whose envelope has something to say — one table, a couple of operations
// with real argument shapes so the served operations map is not degenerate.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema(
  {
    notes: defineTable({
      authorId: v.principal(),
      title: v.string(),
      body: v.string(),
    })
      .visibility({ kind: 'owner', field: 'authorId' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
