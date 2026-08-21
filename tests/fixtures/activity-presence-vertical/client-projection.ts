import { useSnapbackActivityPresence as useExpoActivityPresence } from '@expo/snapback-expo';
import { useSnapbackActivityPresence } from '@expo/snapback-react';
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

export function ExpoTypingComposer() {
  const presence = useExpoActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
    idleMs: 3_000,
  });
  presence.peers satisfies readonly unknown[];
  return null;
}

useSnapbackActivityPresence(typing, {
  scope: { roomId: 'room-one' },
  // @ts-expect-error generated activity values remain exact at the thunk boundary
  value: () => ({ userHandle: 'ada' }),
  idleMs: 3_000,
});
