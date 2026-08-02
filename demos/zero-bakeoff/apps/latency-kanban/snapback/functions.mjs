// @ref LLP 0107#optimistic-mutation-projection — the UI predicts these
// exact fields while server rejection remains authoritative.
import {
  arg,
  asc,
  defineJsMutation,
  defineLiveQuery,
  eq,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const boardCards = defineLiveQuery({
  table: 'cards',
  args: {},
  order: [asc('columnKey'), asc('rank')],
  index: 'by_column_rank',
});

export const cardsInColumn = defineLiveQuery({
  table: 'cards',
  args: { columnKey: v.string() },
  filter: [eq('columnKey', arg('columnKey'))],
  order: [asc('rank')],
  index: 'by_column_rank',
});

export const setupFixture = defineJsMutation({
  args: {},
  result: results.value(v.integer()),
  reads: ['cards', 'columns'],
  writes: ['cards', 'columns'],
  handler: async (ctx) => {
    for (const row of await ctx.db.query('cards').collect()) await ctx.db.delete('cards', row._id);
    for (const row of await ctx.db.query('columns').collect()) await ctx.db.delete('columns', row._id);
    await ctx.db.insert('columns', { key: 'c0', title: 'Backlog', rank: 0 });
    await ctx.db.insert('columns', { key: 'c1', title: 'Ready', rank: 1 });
    await ctx.db.insert('columns', { key: 'c2', title: 'Doing', rank: 2 });
    await ctx.db.insert('columns', { key: 'c3', title: 'Done', rank: 3 });
    for (let i = 0; i < 500; i += 1) {
      await ctx.db.insert('cards', {
        key: `card-${String(i).padStart(3, '0')}`,
        title: `Deterministic card ${i}`,
        columnKey: `c${i % 4}`,
        rank: Math.floor(i / 4) * 100,
        assigneeId: i % 3 === 0 ? 'alice' : (i % 3 === 1 ? 'bob' : 'cara'),
        archived: false,
        locked: i === 7,
        revision: 0,
      });
    }
    return 500;
  },
});

export const moveCard = defineJsMutation({
  args: {
    id: v.id('cards'),
    columnKey: v.string(),
    rank: v.integer(),
    expectedRevision: v.integer(),
  },
  result: results.document('cards'),
  reads: ['cards'],
  writes: ['cards'],
  handler: async (ctx, args) => {
    const card = await ctx.db.get('cards', args.id);
    if (!card) throw new Error('CARD_NOT_FOUND');
    if (card.locked) throw new Error('CARD_LOCKED');
    if (card.revision !== args.expectedRevision) throw new Error('CARD_REVISION_CONFLICT');
    await ctx.db.patch('cards', args.id, {
      columnKey: args.columnKey,
      rank: args.rank,
      revision: card.revision + 1,
    });
    return await ctx.db.get('cards', args.id);
  },
});

export const setCardLocked = defineJsMutation({
  args: { id: v.id('cards'), locked: v.boolean() },
  result: results.document('cards'),
  reads: ['cards'],
  writes: ['cards'],
  handler: async (ctx, args) => {
    const card = await ctx.db.get('cards', args.id);
    if (!card) throw new Error('CARD_NOT_FOUND');
    await ctx.db.patch('cards', args.id, { locked: args.locked });
    return await ctx.db.get('cards', args.id);
  },
});
