import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import 'expo-sqlite/localStorage/install';
import {
  SnapbackClient,
  registerExpoFileSystemRqsFiles,
} from '@expo/snapback-client';
import {
  createSnapbackReactProvider,
  SnapbackProvider,
} from '@expo/snapback-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import api, { type GeneratedDataModel, type Id } from '@relay/generated-api';
import schema from '../../snapback/generated/schema.manifest.json';
import functions from '../../snapback/generated/functions.manifest.json';
import capabilityManifest from '../../snapback/generated/capability.manifest.json';
import { palette } from '@/theme/colors';

if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

type User = GeneratedDataModel['users'];
type Provider = ReturnType<typeof createSnapbackReactProvider>;
type Ready = { client: SnapbackClient; provider: Provider };

type RelayContextValue = Readonly<{
  activeUserId: Id<'users'>;
  setActiveUserId: (id: Id<'users'>) => void;
  client: SnapbackClient;
  storeInfo: unknown;
}>;

const RelayContext = createContext<RelayContextValue | null>(null);
const PERSONA_KEY = 'relay-room.snapback.persona';
const DEFAULT_USER = 'user_ada' as Id<'users'>;
export const snapbackApi = api;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function RelayProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [boot, setBoot] = useState<{ state: 'booting' } | { state: 'ready'; value: Ready } | { state: 'error'; error: string }>({ state: 'booting' });
  const [activeUserId, setUser] = useState<Id<'users'>>(() => {
    const stored = globalThis.localStorage?.getItem(PERSONA_KEY);
    return (stored || DEFAULT_USER) as Id<'users'>;
  });
  const task = useRef<Promise<Ready> | null>(null);

  useEffect(() => {
    let live = true;
    const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4425';
    task.current ??= (async () => {
      const client = new SnapbackClient(origin);
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
      return { client, provider: createSnapbackReactProvider(binding) };
    })();
    void task.current.then(
      (value) => live && setBoot({ state: 'ready', value }),
      (error) => live && setBoot({ state: 'error', error: message(error) }),
    );
    return () => { live = false; };
  }, []);

  const setActiveUserId = (id: Id<'users'>) => {
    globalThis.localStorage?.setItem(PERSONA_KEY, id);
    setUser(id);
  };

  const context = useMemo<RelayContextValue | null>(() => boot.state === 'ready' ? ({
    activeUserId,
    setActiveUserId,
    client: boot.value.client,
    storeInfo: boot.value.client.rqsStoreInfo,
  }) : null, [activeUserId, boot]);

  if (boot.state === 'booting') {
    return <Centered title="Opening Relay Room…"><ActivityIndicator color={palette.accent} /></Centered>;
  }
  if (boot.state === 'error') {
    return <Centered title="Relay Room couldn't start" detail={boot.error} />;
  }

  return (
    <SnapbackProvider provider={boot.value.provider}>
      <RelayContext.Provider value={context}>{children}</RelayContext.Provider>
    </SnapbackProvider>
  );
}

function Centered({ title, detail, children }: Readonly<{ title: string; detail?: string; children?: React.ReactNode }>) {
  return (
    <View style={styles.centered}>
      <View style={styles.logo}><Text style={styles.logoText}>R</Text></View>
      <Text selectable style={styles.title}>{title}</Text>
      {detail ? <Text selectable style={styles.detail}>{detail}</Text> : children}
    </View>
  );
}

export function useRelay() {
  const value = useContext(RelayContext);
  if (!value) throw new Error('useRelay must be used inside RelayProvider');
  return value;
}

export type RelayUser = User;

const styles = StyleSheet.create({
  centered: { alignItems: 'center', backgroundColor: palette.canvas, flex: 1, gap: 14, justifyContent: 'center', padding: 24 },
  logo: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 22, height: 68, justifyContent: 'center', width: 68 },
  logoText: { color: '#FFFFFF', fontSize: 32, fontWeight: '900' },
  title: { color: palette.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  detail: { color: palette.danger, fontSize: 14, lineHeight: 20, maxWidth: 520, textAlign: 'center' },
});
