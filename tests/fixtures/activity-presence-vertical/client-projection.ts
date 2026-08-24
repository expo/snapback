import { useMemo } from 'react';
import { useSnapbackActivityPresence as useExpoActivityPresence } from '@expo/snapback-expo';
import { skip, useSnapbackActivityPresence, useSurface } from '@expo/snapback-react';
import { app } from './generated/app';

const typing = app.api.ephemeral.typing;

export function TypingComposer() {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
    idleMs: 3_000,
  });

  const onKeystroke = () => presence.touch();
  const onClearOrSend = () => void presence.withdraw();
  void onKeystroke;
  void onClearOrSend;
  return null;
}

export function VolatileTypingValue({ displayName }: { displayName: string }) {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: `${displayName}-${Date.now()}` }),
    idleMs: 3_000,
  });
  const onKeystroke = () => presence.touch();
  void onKeystroke;
  return null;
}

export function StableTypingValue({ displayName }: { displayName: string }) {
  const boundValue = useMemo(
    () => ({ userHandle: 'ada', name: displayName }),
    [displayName],
  );
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => boundValue,
    idleMs: 3_000,
  });
  const onKeystroke = () => presence.touch();
  void onKeystroke;
  return null;
}

export function ExpoTypingComposer() {
  const presence = useExpoActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
    idleMs: 3_000,
  });
  presence.peers satisfies readonly unknown[];
  return null;
}

export function BoundTypingComposer({ enabled }: { enabled: boolean }) {
  const surface = useSurface(app.surfaces.typingRoom, { roomId: 'room-one' }, {
    presence: {
      typing: enabled ? { userHandle: 'ada', name: 'Ada' } : skip,
    },
  });
  surface.presence.typing.members satisfies readonly unknown[];
  return null;
}

useSnapbackActivityPresence(typing, {
  scope: { roomId: 'room-one' },
  // @ts-expect-error generated activity values remain exact at the thunk boundary
  value: () => ({ userHandle: 'ada' }),
  idleMs: 3_000,
});
