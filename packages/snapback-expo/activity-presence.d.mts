import type {
  ActivityPresenceOptions,
  ActivityPresenceState,
  ConnectionEphemeralCollectionReference,
} from '@expo/snapback-react';
import type { EphemeralValue } from '@expo/snapback-client';

export function useSnapbackActivityPresence<
  Ref extends ConnectionEphemeralCollectionReference,
>(
  reference: Ref,
  options: ActivityPresenceOptions<Ref>,
): ActivityPresenceState<EphemeralValue<Ref>>;
