import { mutation, query, v } from './generated/server';
import { titleValidator } from './contracts';

export const list = query({
  args: {},
  returns: v.array(v.doc('todos')),
  auth: 'public',
  reads: ['todos'],
  handler: async (ctx) => ctx.db.query('todos').collect(),
});

export const create = mutation({
  args: { title: titleValidator },
  returns: v.id('todos'),
  auth: 'public',
  reads: [],
  writes: ['todos'],
  handler: async (ctx, args) => ctx.db.insert('todos', {
    title: args.title,
    completed: false,
  }),
});
