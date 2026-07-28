import type {
  PreparedReactQueryGroup,
  SnapbackFunctionReference,
  SnapbackQueryGroupReference,
} from '@snapback/client';
import {
  skip,
  useSnapbackMutation,
  useSnapbackQueries,
  useSnapbackQuery,
} from './index.mjs';

declare const todos: SnapbackFunctionReference<
  'todos',
  'LiveQuery',
  { owner: string },
  ReadonlyArray<{ _id: string; title: string }>
>;
declare const feed: SnapbackFunctionReference<
  'feed',
  'LiveQuery',
  Record<string, never>,
  ReadonlyArray<{ _id: string; body: string }>
>;
declare const createTodo: SnapbackFunctionReference<
  'createTodo',
  'Mutation',
  { title: string },
  string
>;
type WorkspaceGroup = SnapbackQueryGroupReference<
  '/workspace/:owner',
  { owner: string },
  {
    todos: { readonly ref: typeof todos; readonly args: { owner: string } };
    feed: { readonly ref: typeof feed; readonly args: Record<string, never> };
  }
>;
declare const primedWorkspace: PreparedReactQueryGroup<WorkspaceGroup>;

const query = useSnapbackQuery(todos, { owner: 'ada' });
if (query.status === 'ready' || query.status === 'refreshing') {
  query.data[0]?.title.toUpperCase();
}

const group = useSnapbackQueries({
  todos: { ref: todos, args: { owner: 'ada' } },
  feed: { ref: feed, args: {} },
  hidden: { ref: feed, args: skip },
} as const);
if (group.queries.todos.status === 'ready') {
  group.queries.todos.data[0]?.title.toUpperCase();
}
if (group.queries.feed.status === 'ready') {
  group.queries.feed.data[0]?.body.toUpperCase();
}
const primed = useSnapbackQueries(primedWorkspace);
if (primed.queries.todos.status === 'ready') {
  primed.queries.todos.data[0]?.title.toUpperCase();
}
if (primed.queries.feed.status === 'ready') {
  primed.queries.feed.data[0]?.body.toUpperCase();
}

const create = useSnapbackMutation(createTodo);
create({ title: 'ship it' }).then((id) => id.toUpperCase());

// @ts-expect-error exact query args are inferred from the reference.
useSnapbackQuery(todos, { ownerId: 'ada' });
// @ts-expect-error excess query args are refused.
useSnapbackQuery(todos, { owner: 'ada', extra: true });
// @ts-expect-error wrong reference kind is refused.
useSnapbackQuery(createTodo, { title: 'wrong' });
// @ts-expect-error exact mutation args are inferred from the reference.
create({ body: 'wrong key' });
