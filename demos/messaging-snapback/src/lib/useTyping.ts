// "X is typing…" — ephemeral state has no React hook in @expo/snapback-react
// yet (guide/realtime/ephemeral-state.md), so this hand-wires
// client.subscribeEphemeral the same way demos/cursors-web's useCursorRoom
// does: subscribe once per mount with a fresh connection id, publish on
// keystrokes under the declared budget, let the server-side TTL (6s) clear a
// stale typer if a client vanishes without an explicit clear.
import { useEffect, useRef, useState } from 'react';
import { ephemeral } from '@generated/api.mjs';
import { getSnapbackClient } from './snapback';

export type Typer = { userHandle: string; name: string };

const typingRef = ephemeral.typing;
const PUBLISH_TTL_MS = typingRef.maxTtlMs;

export function useTyping(conversationId: string, selfHandle: string) {
  const [typers, setTypers] = useState<Typer[]>([]);
  const overlayRef = useRef<any>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    const client = getSnapbackClient();
    if (!client) return undefined;
    const connectionId = `typing_${Math.random().toString(36).slice(2)}_${Date.now()}`;

    let offChange: (() => void) | null = null;
    void client
      .subscribeEphemeral(typingRef, { connectionId, scope: { conversationId } })
      .then((overlay: any) => {
        if (disposedRef.current) {
          overlay.dispose();
          return;
        }
        overlayRef.current = overlay;
        const recompute = () => {
          const entries = overlay.currentEntries() as Array<{ key: string; value: Typer }>;
          setTypers(
            entries
              .filter((entry) => entry.key !== overlay.grantedConnectionId)
              .filter((entry) => entry.value.userHandle !== selfHandle)
              .map((entry) => entry.value),
          );
        };
        offChange = overlay.onChange(recompute);
        recompute();
      })
      .catch(() => {});

    return () => {
      disposedRef.current = true;
      offChange?.();
      overlayRef.current?.dispose();
      overlayRef.current = null;
    };
  }, [conversationId, selfHandle]);

  function publishTyping(name: string) {
    overlayRef.current?.publish({ userHandle: selfHandle, name }, { ttlMs: PUBLISH_TTL_MS }).catch(() => {});
  }

  function clearTyping() {
    overlayRef.current?.delete().catch(() => {});
  }

  return { typers, publishTyping, clearTyping };
}
