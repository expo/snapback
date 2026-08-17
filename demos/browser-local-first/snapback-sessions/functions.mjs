// The sessions-mode backend serves the exact same function surface; only the
// schema's auth mode differs (see ./schema.mjs).

import { defineJsLiveQuery, results, v } from '../../_kit/define.mjs';

// Re-declare the opaque probe in this authored module so sessions codegen can
// certify its inline-handler source instead of trying to serialize the
// function value carried through an export-star boundary.
export const protectedTodosFeed = defineJsLiveQuery({
  args: { listId: v.string() },
  result: results.documents('todos'),
  reads: ['todos'],
  auth: 'public',
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('todos').take(1024).collect();
    return rows.filter((row) => row.listId === args.listId);
  },
});

export * from '../snapback/functions.mjs';
