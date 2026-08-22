import type { SnapbackFunctionReference } from '@expo/snapback-client';
import {
  skip,
  useSnapbackPresence,
  useSnapbackQueries,
  type ConnectionEphemeralCollectionReference,
  type SkipOr,
  type SkipSentinel,
} from './index.mjs';

// React's useMemo inference contract, kept local so this declaration-only
// fixture does not need a second copy of React's ambient type package.
declare function useMemo<Value>(factory: () => Value, dependencies: readonly unknown[]): Value;

type TypingScope = { conversationId: string };
type TypingValue = { userHandle: string; name: string };

declare const typing: ConnectionEphemeralCollectionReference<
  'typing',
  TypingScope,
  TypingValue
>;
declare const conversationId: string;
declare const observingOnly: boolean;

skip satisfies SkipSentinel;
skip satisfies SkipOr<TypingValue>;

const presenceOptions = useMemo(() => ({
  scope: { conversationId },
  value: observingOnly ? skip : { userHandle: 'ada', name: 'Ada' },
  ttlMs: 4_000,
}), [conversationId, observingOnly]);

// No explicit annotation or generic argument should be needed to preserve the
// sentinel through ordinary React memoization.
useSnapbackPresence(typing, presenceOptions);

declare const messages: SnapbackFunctionReference<
  'messages',
  'LiveQuery',
  { conversationId: string },
  readonly { body: string }[]
>;

const queryEntries = useMemo(() => ({
  messages: { ref: messages, args: skip },
}), [messages]);

useSnapbackQueries(queryEntries);
