import type {
  PreparedReactQueryGroup,
  SnapbackFunctionReference,
} from '@snapback/client';
import type {
  GeneratedQueryGroups as BackendBakeoffQueryGroups,
} from '../../demos/signal-desk/snapback/generated/api.d.ts';
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
// @ref LLP 0112#evidence-and-acceptance — the prepared-group result proof
// consumes a maintained app's emitted declaration, not a hand-authored twin.
declare const generatedBackendBakeoff:
  PreparedReactQueryGroup<BackendBakeoffQueryGroups['/']>;

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
const realGeneratedGroup = useSnapbackQueries(generatedBackendBakeoff);
if (realGeneratedGroup.queries.listIncidents.status === 'ready') {
  realGeneratedGroup.queries.listIncidents.data[0]?.title.toUpperCase();
}
if (realGeneratedGroup.queries.allTasks.status === 'ready') {
  realGeneratedGroup.queries.allTasks.data[0]?.body.toUpperCase();
}
if (realGeneratedGroup.queries.allComments.status === 'ready') {
  realGeneratedGroup.queries.allComments.data[0]?.body.toUpperCase();
}
if (realGeneratedGroup.queries.allActivity.status === 'ready') {
  realGeneratedGroup.queries.allActivity.data[0]?.kind.toUpperCase();
}
// @ts-expect-error the real generated route declaration has four exact keys.
realGeneratedGroup.queries.incidentTasks;

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
