import { api } from 'snapback2/client';
import { journey } from 'snapback2/test';
journey('complete preserves ownership and changes done', async ({ as }) => {
  const alice = as('alice');
  const bob = as('bob');
  const refused = await bob.mutation(api.todos.complete, { todoId: 'todo-1' });
  if (refused.state !== 'rejected') throw new Error('non-owner completion was admitted');
  const before = await alice.query(api.todos.list, {});
  if (!('data' in before) || !before.data?.some(row => row.id === 'todo-1' && row.done === false)) throw new Error('refused write changed the seed');
  const completed = await alice.mutation(api.todos.complete, { todoId: 'todo-1' });
  if (completed.state !== 'committed') throw new Error('owner completion was refused');
  const after = await alice.query(api.todos.list, {});
  if (!('data' in after) || !after.data?.some(row => row.id === 'todo-1' && row.done === true)) throw new Error('completion did not change done');
  const privateRows = await bob.query(api.todos.list, {});
  if ('data' in privateRows && privateRows.data?.some(row => row.id === 'todo-1')) throw new Error('private todo leaked to bob');
});
