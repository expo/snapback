import {
  useSnapbackActivityPresence,
  type ConnectionEphemeralCollectionReference,
} from './index.mjs';

type TypingValue = { userHandle: string; name: string };
type TypingScope = { conversationId: string };

declare const typing: ConnectionEphemeralCollectionReference<'typing', TypingScope, TypingValue>;

const activity = useSnapbackActivityPresence(typing, {
  scope: { conversationId: 'conversation-1' },
  value: () => ({ userHandle: 'ada', name: 'Ada' }),
  idleMs: 3_000,
  excludeSelf: true,
  onError(diagnostic) {
    diagnostic.code satisfies string;
  },
});

activity.status satisfies 'pending' | 'resyncing' | 'ready' | 'stale' | 'error' | 'unsupported';
activity.active satisfies boolean;
activity.touch();
activity.withdraw() satisfies Promise<void>;
activity.peers[0]?.value.name satisfies string | undefined;
activity.publisher.status satisfies 'observing' | 'publishing' | 'published' | 'publish-error';
activity.lastError?.code satisfies string | undefined;

useSnapbackActivityPresence(typing, {
  scope: { conversationId: 'conversation-1' },
  // @ts-expect-error generated values remain exact at the thunk boundary
  value: () => ({ userHandle: 'ada' }),
  idleMs: 3_000,
});
