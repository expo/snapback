declare const data: any;

export const ascending = data.todos
  .using('by_owner_bucket_created')
  .orderBy('bucket', 'asc')
  .take(2);

export const descending = data.todos
  .using('by_owner_bucket_created')
  .orderBy('bucket', 'desc')
  .take(2);

export const ownerOnlyDescending = data.todos
  .using('by_owner')
  .orderBy('_id', 'desc')
  .take(1);

export const oversizedCursor = data.todos
  .using('by_owner_cursor_text')
  .orderBy('cursorText', 'asc')
  .take(1);
