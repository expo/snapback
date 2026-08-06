import { useMemo } from 'react';
import { skip, useSnapbackPresence } from '@messenger/snapback-react';
import { ephemeral } from '@generated/api.mjs';

export type Typer = { userHandle: string; name: string };

const typingRef = ephemeral.typing;
const PUBLISH_TTL_MS = typingRef.maxTtlMs;

// `useSnapbackPresence` is the React hook for generated ephemeral collections.
// Observer mode keeps publish/delete imperative so clearing a typing indicator
// remains immediate while the provider owns the room, heartbeat, and cleanup.
export function useTyping(conversationId: string, selfHandle: string) {
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const presence = useSnapbackPresence(typingRef, { scope, value: skip });
  const typers = useMemo<Typer[]>(() => {
    if (presence.status !== 'ready' && presence.status !== 'stale') return [];
    return presence.entries
      .filter((entry) => entry.key !== presence.selfKey)
      .filter((entry) => entry.value.userHandle !== selfHandle)
      .map((entry) => entry.value);
  }, [presence, selfHandle]);

  function publishTyping(name: string) {
    void presence
      .publish({ userHandle: selfHandle, name }, { ttlMs: PUBLISH_TTL_MS })
      .catch(() => {});
  }

  function clearTyping() {
    void presence.delete().catch(() => {});
  }

  return { typers, publishTyping, clearTyping };
}
