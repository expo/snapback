import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createExternalSessionClient, type SnapbackClient } from '@expo/snapback-client';
import { SnapbackProvider, createSnapbackReactProvider } from '@expo/snapback-react';
// The full generated app descriptor: binding admission in descriptor mode is
// what makes generated `api.ephemeral.*` references admissible to the
// presence hook (manifest-only binding refused them).
// @ts-ignore - .mjs module resolution
import { app } from './generated/api.mjs';
import { mintPersonaSession, type Persona } from './broker';

export type BackendState =
  | { status: 'connecting' }
  | { status: 'offline'; error: string }
  | {
      status: 'ready';
      client: SnapbackClient;
      provider: unknown;
      serverUrl: string;
      persona: Persona;
    };

const BackendContext = createContext<{ serverUrl: string; persona: Persona } | null>(null);

export function useBackendInfo() {
  const value = useContext(BackendContext);
  if (!value) throw new Error('useBackendInfo outside provider');
  return value;
}

export function useBackend(persona: Persona): BackendState {
  const [state, setState] = useState<BackendState>({ status: 'connecting' });

  useEffect(() => {
    let cancelled = false;
    let client: SnapbackClient | null = null;
    setState({ status: 'connecting' });
    (async () => {
      const minted = await mintPersonaSession(persona.email);
      client = createExternalSessionClient(minted.serverUrl, {
        bearerToken: minted.bearerToken,
        clientStoreId: `rematch-${persona.handle}`,
      });
      const binding = await client.prepareReactBinding({
        generatedManifest: app as any,
      });
      const provider = createSnapbackReactProvider(binding);
      if (cancelled) return;
      setState({
        status: 'ready',
        client,
        provider,
        serverUrl: minted.serverUrl,
        persona,
      });
    })().catch((error) => {
      if (!cancelled) setState({ status: 'offline', error: String(error?.message ?? error) });
    });
    return () => {
      cancelled = true;
      if (client) void client.closeAuth().catch(() => {});
    };
  }, [persona.handle]);

  return state;
}

export function BackendProvider({
  state,
  children,
}: {
  state: Extract<BackendState, { status: 'ready' }>;
  children: React.ReactNode;
}) {
  const info = useMemo(
    () => ({ serverUrl: state.serverUrl, persona: state.persona }),
    [state.serverUrl, state.persona],
  );
  return (
    <BackendContext.Provider value={info}>
      <SnapbackProvider provider={state.provider as any}>{children}</SnapbackProvider>
    </BackendContext.Provider>
  );
}
