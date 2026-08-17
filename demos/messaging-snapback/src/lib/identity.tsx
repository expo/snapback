// Dev-mode persona switcher — the same trade-off Warble documents: bootstrap
// and typing direct calls assert the selected persona, not a real session, so
// this context tracks "who am I right now" for the demo's UI. Switching
// personas is how one browser tab can stand in for "someone else typing" or
// "someone else reacting" when verifying the live-update path end to end.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { SnapbackClient } from '@expo/snapback-client';

export type Persona = {
  handle: string;
  name: string;
  avatarEmoji: string;
  avatarColor: string;
};

export const PERSONAS: Persona[] = [
  { handle: 'lin', name: 'Lin Chen', avatarEmoji: '🦊', avatarColor: '#F97362' },
  { handle: 'ada', name: 'Ada Lovelace', avatarEmoji: '🦄', avatarColor: '#8B5CF6' },
  { handle: 'grace', name: 'Grace Hopper', avatarEmoji: '⚓️', avatarColor: '#2563EB' },
  { handle: 'mo', name: 'Mo Farah', avatarEmoji: '🏃', avatarColor: '#16A34A' },
  { handle: 'priya', name: 'Priya Rao', avatarEmoji: '🌈', avatarColor: '#DB2777' },
];

const IdentityContext = createContext<{
  client: SnapbackClient;
  self: Persona;
  setSelf: (handle: string) => void;
} | null>(null);

export function IdentityProvider({ children, client }: { children: ReactNode; client: SnapbackClient }) {
  const [handle, setHandle] = useState('lin');
  const value = useMemo(() => ({
    client,
    self: PERSONAS.find((p) => p.handle === handle) ?? PERSONAS[0],
    setSelf: setHandle,
  }), [client, handle]);
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within IdentityProvider');
  return ctx;
}

export function avatarFor(handle: string): Persona {
  return PERSONAS.find((p) => p.handle === handle) ?? {
    handle,
    name: handle,
    avatarEmoji: '👤',
    avatarColor: '#9CA3AF',
  };
}
