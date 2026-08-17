import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { SnapbackClient } from '@expo/snapback-client';
import { ephemeral } from '@generated/api.mjs';
import { useIdentity } from '@/lib/identity';

export type Typer = { userHandle: string; name: string };

type TypingOverlay = {
  currentEntries(): Array<{ value: Typer }>;
  delete(): Promise<unknown>;
  dispose(): void;
  onChange(listener: () => void): () => void;
  publish(value: Typer, options?: { ttlMs?: number }): Promise<unknown>;
};

const typingRef = ephemeral.typing;
let typingConnectionSequence = 0;

function reportTypingFailure(action: string, error: unknown) {
  console.warn(`[messaging-snapback] typing ${action} failed`, error);
}

// @ref LLP 0257#expo-backgrounding-and-resume — backgrounding withdraws the
// current entry instead of waiting for its TTL to expire.
// @ref LLP 0013#authorization-and-privacy — this dev-only direct path asserts
// the selected persona and the exact generated room permission on subscribe;
// overlay publication inherits both. Sessions mode ignores these assertions.
export function useTyping(conversationId: string, selfHandle: string, selfName: string) {
  const { client } = useIdentity();
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const permissions = useMemo(
    () => [(SnapbackClient as unknown as {
      roomPermission(prefix: string, permissionScope: Record<string, unknown>): string;
    }).roomPermission('m_conversationMemberships', scope)],
    [scope],
  );
  const [entries, setEntries] = useState<Array<{ value: Typer }>>([]);
  const overlayRef = useRef<TypingOverlay | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTyping = useCallback(async () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const overlay = overlayRef.current;
    if (overlay) await overlay.delete();
  }, []);

  const publishTyping = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    void overlay
      .publish({ userHandle: selfHandle, name: selfName })
      .catch((error) => reportTypingFailure('publish', error));
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      void overlay.delete().catch((error) => reportTypingFailure('withdraw', error));
    }, 3_000);
  }, [selfHandle, selfName]);

  useEffect(() => {
    let cancelled = false;
    let overlay: TypingOverlay | null = null;
    let stopObserving: (() => void) | null = null;
    const connectionId = `messenger-typing-${selfHandle}-${typingConnectionSequence += 1}`;

    setEntries([]);
    void client.subscribeEphemeral(typingRef, {
      connectionId,
      scope,
      userId: selfHandle,
      permissions,
    }).then((subscribed) => {
      overlay = subscribed;
      if (cancelled) {
        void subscribed.delete().catch(() => {}).finally(() => subscribed.dispose());
        return;
      }
      overlayRef.current = subscribed;
      const refresh = () => setEntries(subscribed.currentEntries());
      stopObserving = subscribed.onChange(refresh);
      refresh();
    }).catch((error) => {
      if (!cancelled) reportTypingFailure('subscribe', error);
    });

    return () => {
      cancelled = true;
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      stopObserving?.();
      if (overlayRef.current === overlay) overlayRef.current = null;
      if (overlay) {
        void overlay.delete().catch(() => {}).finally(() => overlay?.dispose());
      }
    };
  }, [client, permissions, scope, selfHandle]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void clearTyping().catch((error) => reportTypingFailure('background withdrawal', error));
      }
    });
    return () => subscription.remove();
  }, [clearTyping]);

  const typers = useMemo<Typer[]>(() => entries
    .filter((entry) => entry.value.userHandle !== selfHandle)
    .map((entry) => entry.value), [entries, selfHandle]);

  return { typers, publishTyping, clearTyping };
}
