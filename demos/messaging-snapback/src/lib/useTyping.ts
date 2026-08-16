import { useMemo } from 'react';
import { useSnapbackActivityPresence } from '@messenger/snapback-expo';
import { ephemeral } from '@generated/api.mjs';

export type Typer = { userHandle: string; name: string };

const typingRef = ephemeral.typing;

// @ref LLP 0257#expo-backgrounding-and-resume — the Expo facade adds
// background withdrawal to the canonical activity state machine.
export function useTyping(conversationId: string, selfHandle: string, selfName: string) {
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const presence = useSnapbackActivityPresence(typingRef, {
    scope,
    value: () => ({ userHandle: selfHandle, name: selfName }),
    idleMs: 3_000,
  });
  const typers = useMemo<Typer[]>(() => {
    return presence.peers
      .filter((entry) => entry.value.userHandle !== selfHandle)
      .map((entry) => entry.value);
  }, [presence, selfHandle]);

  return {
    typers,
    publishTyping: presence.touch,
    clearTyping: presence.withdraw,
  };
}
