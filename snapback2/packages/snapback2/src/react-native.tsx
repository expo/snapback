import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { SnapbackProvider as CoreProvider, useSnapbackClient } from './react-core.js';
import { expoSqliteStore, type CreateExpoClientOptions } from './expo/index.js';
import { expoSecureTokenStore } from './expo/token-store.js';
import type { SnapbackClient, CreateClientOptions } from './types.js';
export * from './react-core.js';
export { AssetImage, AssetVideo } from './react-native/components.js';
export { useAssetFile } from './react-native/source.js';
export type { AssetImageProps, AssetVideoProps } from './react-native/components.js';

export type SnapbackProviderProps = (
  | (CreateExpoClientOptions & { client?: never })
  | { client: SnapbackClient; startOffline?: never; url?: never; persona?: never; token?: never; tokenStore?: never; fetch?: never; offline?: never }
) & { children: ReactNode };

/** Native custody defaults with the shared provider's StrictMode and deferred-close lifetime. */
export function SnapbackProvider(props: SnapbackProviderProps): React.ReactElement {
  const defaults = useRef<Pick<CreateClientOptions, 'offline' | 'tokenStore'>>(undefined);
  defaults.current ??= { offline: { store: expoSqliteStore() }, tokenStore: expoSecureTokenStore() };
  if (props.client) return <CoreProvider client={props.client}>{props.children}</CoreProvider>;
  const options = { ...props, fetch: props.fetch ?? expoFetch,
    offline: { ...props.offline, store: props.offline?.store ?? defaults.current.offline!.store },
    ...(props.persona === undefined ? { tokenStore: props.tokenStore ?? defaults.current.tokenStore } : {}),
  } as CreateClientOptions;
  return <CoreProvider {...options}><Ready>{props.children}</Ready></CoreProvider>;
}

/** Carrier startup can fail before any query opens; the provider owns that failure too. */
function Ready({ children }: { children: ReactNode }): React.ReactElement {
  const client = useSnapbackClient();
  const [failure, setFailure] = useState<{ client: SnapbackClient; message: string }>();
  useEffect(() => {
    let active = true;
    void client.ready.catch(error => {
      if (active) setFailure({ client, message: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [client]);
  return failure?.client === client ? <Text accessibilityRole="alert">{failure.message}</Text> : <>{children}</>;
}
