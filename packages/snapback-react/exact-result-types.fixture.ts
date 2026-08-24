import type {
  PreparedReactBinding,
  PreparedReactQueryGroup,
  SnapbackAppClient,
  SnapbackFunctionReference,
} from '@expo/snapback-client';
import type {
  GeneratedQueryGroups as BackendBakeoffQueryGroups,
} from '../../demos/team-chat/snapback/generated/api.d.ts';
import type { GeneratedAppDescriptorV1 as ConversationAppDescriptor } from './fixtures/conversation/app/snapback/generated/app.d.ts';
import type { Id } from './fixtures/conversation/app/snapback/generated/api.d.ts';
import {
  projectRecordFields,
  skip,
  useSnapbackCommand,
  useSnapbackMutation,
  useSnapbackSettledMutation,
  useSnapbackQueries,
  useSnapbackQuery,
  useSurface,
} from './index.mjs';
import type { SnapbackProviderProps } from './index.mjs';

declare const ordinaryAppClient: SnapbackAppClient;
declare const advancedBinding: PreparedReactBinding;
declare const declaredDevConversationApp: ConversationAppDescriptor;
const declaredDevProviderOwnership: SnapbackProviderProps = {
  app: declaredDevConversationApp,
  url: 'http://localhost:4287',
  platform: 'browser',
};
void declaredDevProviderOwnership;
// @ts-expect-error ordinary app-client ownership and advanced binding injection are exclusive.
const mixedProviderOwnership: SnapbackProviderProps = {
  appClient: ordinaryAppClient,
  binding: advancedBinding,
};
void mixedProviderOwnership;

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
if (query.status === 'blocked') {
  const owner: 'auth-coordinator' = query.transitionOwner;
  const reason: 'authentication-required' | 'authentication-not-settled' = query.reason;
  void owner;
  void reason;
}
if (query.status === 'error' && query.transitionOwner !== undefined) {
  const owner: 'auth-coordinator' = query.transitionOwner;
  void owner;
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
if (realGeneratedGroup.queries.unreadDeliveries.status === 'ready') {
  realGeneratedGroup.queries.unreadDeliveries.data[0]?.body.toUpperCase();
}
// @ts-expect-error the real generated route declaration has exactly one key.
realGeneratedGroup.queries.roomMessages;

const create = useSnapbackMutation(createTodo);
create({ title: 'ship it' }).then((outcome) => {
  if (outcome.status === 'settled') outcome.result.toUpperCase();
  else {
    outcome.clientMutationId.toUpperCase();
    outcome.sequence.toFixed();
    const presentation: 'installed' | 'withheld' | 'unavailable' = outcome.presentation;
    void presentation;
  }
});
const createRequired = useSnapbackMutation(createTodo, { queue: false });
createRequired({ title: 'connectivity required' }).then((id) => id.toUpperCase());
const createSettled = useSnapbackSettledMutation(createTodo);
createSettled({ title: 'settled convenience' }).then((id) => id.toUpperCase());

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
rename({ id: 'todo_1', title: 'renamed' }).then((outcome) => {
  if (outcome.status === 'settled') outcome.result.title.toUpperCase();
  else outcome.presentation.toUpperCase();
});
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
declare const commandImage: {
  readonly size: number;
  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
};
const directSend = useSnapbackCommand(conversationApp.commands.send);
directSend({ conversationId, senderId: userId, body: 'hello', image: commandImage })
  .done.then((outcome) => {
    if (outcome.kind === 'committed') outcome.result.messageId;
    if (outcome.kind === 'failed') outcome.residue?.unattached;
  });
const conversation = useSurface(
  conversationApp.surfaces.conversation,
  { conversationId },
  { presence: { typing: { displayName: 'Ada' } } },
);
conversation.mutations.addReaction({ messageId, userId, emoji: '👍' });
conversation.mutations.addReaction({ messageId, userId, emoji: '👍' }).then((outcome) => {
  if (outcome.status === 'settled') outcome.result.reactionId;
  else outcome.clientMutationId;
});
conversation.commands.send({ body: 'hello', image: commandImage });
conversation.data.messages?.[0]?.text?.toUpperCase();
conversation.state.messages.retention;
conversation.presence.typing.members[0]?.value.displayName.toUpperCase();
// @ts-expect-error conversationId is already bound at the surface.
conversation.mutations.addReaction({ conversationId, messageId, userId, emoji: '👍' });
// @ts-expect-error conversationId and senderId are bound by the surface.
conversation.commands.send({ conversationId, senderId: userId, body: 'wrong' });
useSurface(conversationApp.surfaces.conversation, { conversationId }, {
  presence: { typing: {
    displayName: 'Ada',
    // @ts-expect-error typing identity is session-derived, not a publish member.
    userId: 'forged',
  } },
});
