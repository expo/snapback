import {
  SnapbackClient,
  admitSnapbackId,
  type SnapbackEphemeralReference,
  type SnapbackFunctionReference,
} from './index.mjs';

declare const listTodos: SnapbackFunctionReference<
  'listTodos',
  'LiveQuery',
  { owner: string },
  ReadonlyArray<{ _id: string; title: string }>
>;
declare const createTodo: SnapbackFunctionReference<
  'createTodo',
  'Mutation',
  { title: string },
  string
>;
declare const presence: SnapbackEphemeralReference<
  'presence',
  { roomId: string },
  { userId: string; viewing: string }
>;
type GeneratedId<Table extends string> =
  string & { readonly __snapbackIdTable: Table };

const client = new SnapbackClient('http://127.0.0.1:5050');
const admittedTodoId: GeneratedId<'todos'> = admitSnapbackId('todos', 'todo_01');
admittedTodoId.toUpperCase();
// @ts-expect-error admission preserves the exact table brand.
const admittedWrongId: GeneratedId<'users'> = admitSnapbackId('todos', 'todo_01');
void admittedWrongId;
client.query(listTodos, { args: { owner: 'ada' } }).then((output) => {
  output.rows[0]?.title.toUpperCase();
});
client.mutate(createTodo, { args: { title: 'ship it' } }).then((output) => {
  output.result.toUpperCase();
});
client.liveQuery(listTodos, {
  connectionId: 'fixture',
  args: { owner: 'ada' },
  onUpdate(rows) {
    rows[0]?.title.toUpperCase();
  },
});
client.subscribeEphemeral(presence, {
  connectionId: 'fixture',
  scope: { roomId: 'incident-1' },
}).then((overlay) => overlay.publish({ userId: 'ada', viewing: 'incident' }));

// @ts-expect-error query arguments come from the generated reference.
client.query(listTodos, { args: { ownerId: 'ada' } });
// @ts-expect-error mutation arguments come from the generated reference.
client.mutate(createTodo, { args: { body: 'wrong key' } });
client.subscribeEphemeral(presence, { connectionId: 'fixture' })
  // @ts-expect-error ephemeral values come from the generated reference.
  .then((overlay) => overlay.publish({ userId: 'ada' }));
