import { defineSchema, defineTable, v } from './define.js';
import { defineTable as familiarTable } from './familiar.mjs';

const explicit = defineTable({
  ownerId: v.principal(),
  title: v.string(),
  createdAt: v.integer(),
})
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .data({
    createDefaults: { createdAt: 'now' },
    immutable: ['createdAt'],
  });

defineSchema({ explicit });

// @ts-expect-error `.data(...)` is terminal and exposes no index method.
explicit.index('late', ['title']);
// @ts-expect-error `.data(...)` is terminal and exposes no sync method.
explicit.sync();
// @ts-expect-error `.data(...)` is terminal and cannot repeat.
explicit.data();

defineTable({ title: v.string() })
  // @ts-expect-error `.data(...)` has exactly four keys.
  .data({ unknown: true });

defineTable({ title: v.string() })
  // @ts-expect-error defaults name only schema fields.
  .data({ createDefaults: { missing: 'now' } });

const familiar = familiarTable({ title: v.string() })
  .index('by_title', ['title'])
  .visibility({ kind: 'public-read' })
  .data({ listIndex: 'by_title' });

defineSchema({ familiar });
// @ts-expect-error familiar `.data(...)` is terminal too.
familiar.visibility({ kind: 'public-read' });
