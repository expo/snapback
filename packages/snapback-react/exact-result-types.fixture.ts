import type {
  PreparedReactQueryGroup,
  SnapbackFunctionReference,
} from '@expo/snapback-client';
import type {
  GeneratedQueryGroups as BackendBakeoffQueryGroups,
} from '../../demos/signal-desk/snapback/generated/api.d.ts';
import type { GeneratedAppDescriptorV1 as ConversationAppDescriptor } from '../../demos/expo-golden-path-fixture/snapback/generated/app.d.ts';
import type { Id } from '../../demos/expo-golden-path-fixture/snapback/generated/api.d.ts';
import {
  projectRecordFields,
  skip,
  useSnapbackMutation,
  useSnapbackQueries,
  useSnapbackQuery,
  useSurface,
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

declare const renameTodo: SnapbackFunctionReference<
  'renameTodo',
  'Mutation',
  { id: string; title: string },
  { title: string }
>;
// @ref LLP 0107#replay-safety-affordances — the declarative capture-and-set
// pair spreads into the existing optimistic options against records rows.
const rename = useSnapbackMutation(renameTodo, {
  optimistic: {
    query: todos,
    args: { owner: 'ada' },
    ...projectRecordFields('todo_1', { title: 'renamed' }),
  },
});
rename({ id: 'todo_1', title: 'renamed' }).then((receipt) => receipt.title.toUpperCase());
// @ts-expect-error intended field values must be primitive outcomes.
projectRecordFields('todo_1', { title: { nested: true } });

// @ts-expect-error exact query args are inferred from the reference.
useSnapbackQuery(todos, { ownerId: 'ada' });
// @ts-expect-error excess query args are refused.
useSnapbackQuery(todos, { owner: 'ada', extra: true });
// @ts-expect-error wrong reference kind is refused.
useSnapbackQuery(createTodo, { title: 'wrong' });
// @ts-expect-error exact mutation args are inferred from the reference.
create({ body: 'wrong key' });

// @ref LLP 0179#react-projection — the emitted surface declaration removes
// bound params from child calls while retaining the authored typing payload.
declare const conversationId: Id<'conversations'>;
declare const messageId: Id<'messages'>;
declare const userId: Id<'users'>;
declare const conversationApp: ConversationAppDescriptor;
const conversation = useSurface(
  conversationApp.surfaces.conversation,
  { conversationId },
  { presence: { typing: { displayName: 'Ada' } } },
);
conversation.mutations.addReaction({ messageId, userId, emoji: '👍' });
conversation.data.messages?.[0]?.text?.toUpperCase();
conversation.state.messages.retention;
conversation.presence.typing.members[0]?.value.displayName.toUpperCase();
// @ts-expect-error conversationId is already bound at the surface.
conversation.mutations.addReaction({ conversationId, messageId, userId, emoji: '👍' });
useSurface(conversationApp.surfaces.conversation, { conversationId }, {
  presence: { typing: {
    displayName: 'Ada',
    // @ts-expect-error typing identity is session-derived, not a publish member.
    userId: 'forged',
  } },
});
