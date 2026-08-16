// Todo demo JavaScript handlers for the LLP 0020 Phase 2 ctx.db bridge.
//
// This file is bundled as source into the function manifest. It deliberately
// avoids imports, process/env access, timers, network, and direct storage access;
// the only backend power is the ctx surface passed by Snapback.

globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .order('_createdAt', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('todo title is required');
    return await ctx.db.insert('todos', {
      title,
      completed: false,
    });
  },

  async setCompleted(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.patch('todos', args.id, {
      completed: args.completed,
    })) ? 1 : 0;
  },

  async deleteTodo(ctx, args) {
    const todo = await ctx.db.get('todos', args.id);
    if (!todo) return 0;
    return (await ctx.db.delete('todos', args.id)) ? 1 : 0;
  },
};
