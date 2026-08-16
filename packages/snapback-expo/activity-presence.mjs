import { useEffect } from 'react';

import {
  useSnapbackActivityPresence as useReactActivityPresence,
} from '@expo/snapback-react';

import { resolveSnapbackExpoLifecycleSource } from './lifecycle-source.mjs';
import { useSnapbackExpoLifecycleContext } from './provider.mjs';

const ACTIVITY_PRESENCE_INTERNAL = Symbol.for(
  'snapback.react.activity-presence.internal.v1',
);
const GATED_ACTIVITY_OPTIONS = Object.freeze({
  [ACTIVITY_PRESENCE_INTERNAL]: Object.freeze({ gated: true }),
});

function lifecycleDiagnostic(error) {
  const cause = error?.diagnostic;
  const causeCode = cause?.code ?? error?.code ?? 'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED';
  const causeMessage = cause?.message
    ?? (error instanceof Error ? error.message : String(error));
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: 'SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE',
    severity: 'error',
    message: 'activity presence requires an observable Expo application lifecycle',
    details: Object.freeze({ causeCode, causeMessage }),
  });
}

function removeSubscription(subscription) {
  if (typeof subscription === 'function') subscription();
  else subscription?.remove?.();
}

export function useSnapbackActivityPresence(reference, options) {
  const lifecycleContext = useSnapbackExpoLifecycleContext();
  const activity = useReactActivityPresence(reference, options, GATED_ACTIVITY_OPTIONS);
  const controls = activity[ACTIVITY_PRESENCE_INTERNAL];

  useEffect(() => {
    let current = true;
    let subscription = null;
    const establish = async () => {
      try {
        const source = lifecycleContext?.source
          ?? await resolveSnapbackExpoLifecycleSource(lifecycleContext?.environment ?? null);
        if (!current) return;
        let observedState = null;
        const observe = (state) => {
          if (!current) return;
          observedState = state;
          // @ref LLP 0257#expo-backgrounding-and-resume — the helper listener
          // withdraws only its own activity intent; provider pause/resume
          // remains owned by the facade's separate lifecycle binding.
          controls.setLifecycleActive(state === 'active');
        };
        subscription = source.addEventListener('change', observe);
        if (!current) {
          removeSubscription(subscription);
          subscription = null;
          return;
        }
        // Listener-first, sample-second closes the async setup window. A
        // transition during attachment updates observedState before admission.
        observedState = source.currentState ?? observedState;
        controls.setLifecycleActive(observedState === 'active');
      } catch (error) {
        if (!current) return;
        controls.failLifecycle(lifecycleDiagnostic(error));
      }
    };
    void establish();
    return () => {
      current = false;
      removeSubscription(subscription);
      subscription = null;
    };
  }, [controls, lifecycleContext]);

  return activity;
}
