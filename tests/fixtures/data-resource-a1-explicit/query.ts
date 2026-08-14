// Static Phase 2 catalogue fixture. Runtime values occupy slots and do not
// enter the normalized query witness.
declare const data: any;

export const firstPage = data.todos
  .using('by_owner_created')
  .orderBy('createdAt', 'asc')
  .take(100);
