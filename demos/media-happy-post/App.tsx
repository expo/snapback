import { useCallback, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  registerExpoFileSystemRqsFiles,
  SnapbackClient,
} from '@expo/snapback-client';
import {
  bindSnapbackAppLifecycle,
  createExpoAssetSourceAdapter,
  createSnapbackReactProvider,
  SnapbackProvider,
} from '@expo/snapback-expo';
import type { SnapbackReactProvider } from '@expo/snapback-expo';

import { MEDIA_POST_PERSONAS } from './personas.mjs';
import type { MediaPostPersona } from './personas.mjs';
import { app } from './snapback/generated/app.mjs';
import MediaPostScreen from './src/media-post-screen';

if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4431';

type ActiveSession = Readonly<{
  persona: MediaPostPersona;
  client: SnapbackClient;
  provider: SnapbackReactProvider;
  lifecycle: Readonly<{ dispose(): void }>;
}>;

type BootState =
  | Readonly<{ phase: 'signed-out'; error: string | null }>
  | Readonly<{ phase: 'signing-in'; persona: MediaPostPersona }>
  | Readonly<{ phase: 'ready'; session: ActiveSession }>;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function disposeSession(session: ActiveSession, logout: boolean) {
  session.lifecycle.dispose();
  await session.provider.dispose();
  if (logout) await session.client.authLogout();
  await session.client.closeAuth();
}

function PersonaGate({ onChoose, error }: Readonly<{
  onChoose: (persona: MediaPostPersona) => void;
  error: string | null;
}>) {
  return (
    <SafeAreaView style={gateStyles.screen}>
      <View style={gateStyles.card}>
        <Text style={gateStyles.eyebrow}>SNAPBACK · MEDIA HAPPY PATH</Text>
        <Text style={gateStyles.title}>Choose a test persona</Text>
        <Text style={gateStyles.copy}>
          Each development-only session owns a separate profile and post feed.
        </Text>
        {MEDIA_POST_PERSONAS.map((persona) => (
          <Pressable
            accessibilityRole="button"
            key={persona.id}
            onPress={() => onChoose(persona)}
            style={[gateStyles.persona, { borderLeftColor: persona.accent }]}
          >
            <View style={[gateStyles.initial, { backgroundColor: persona.accent }]}>
              <Text style={gateStyles.initialText}>{persona.displayName.slice(0, 1)}</Text>
            </View>
            <View style={gateStyles.personaCopy}>
              <Text style={gateStyles.personaName}>{persona.displayName}</Text>
              <Text style={gateStyles.personaEmail}>{persona.email}</Text>
            </View>
            <Text style={gateStyles.arrow}>→</Text>
          </Pressable>
        ))}
        {error ? <Text style={gateStyles.error}>{error}</Text> : null}
        <Text style={gateStyles.origin}>Backend: {origin}</Text>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [boot, setBoot] = useState<BootState>({ phase: 'signed-out', error: null });

  const signIn = useCallback(async (persona: MediaPostPersona) => {
    setBoot({ phase: 'signing-in', persona });
    const client = new SnapbackClient(origin);
    try {
      await client.authPasswordSignIn({ email: persona.email, password: persona.password });
      const binding = await client.prepareReactBinding({ generatedManifest: app });
      const provider = createSnapbackReactProvider(binding, {
        connectionId: `media-post-${persona.id}`,
        assetSourceAdapter: createExpoAssetSourceAdapter(),
      });
      const lifecycle = bindSnapbackAppLifecycle(AppState, provider);
      setBoot({ phase: 'ready', session: { persona, client, provider, lifecycle } });
    } catch (error) {
      await client.closeAuth();
      setBoot({ phase: 'signed-out', error: errorText(error) });
    }
  }, []);

  const signOut = useCallback(async (session: ActiveSession) => {
    setBoot({ phase: 'signed-out', error: null });
    try {
      await disposeSession(session, true);
    } catch (error) {
      setBoot({ phase: 'signed-out', error: errorText(error) });
    }
  }, []);

  if (boot.phase === 'signed-out') {
    return <PersonaGate error={boot.error} onChoose={(persona) => void signIn(persona)} />;
  }
  if (boot.phase === 'signing-in') {
    return (
      <SafeAreaView style={gateStyles.screen}>
        <View style={gateStyles.loading}>
          <ActivityIndicator color={boot.persona.accent} size="large" />
          <Text style={gateStyles.loadingText}>Signing in as {boot.persona.displayName}…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SnapbackProvider provider={boot.session.provider}>
      <MediaPostScreen
        persona={boot.session.persona}
        onSignOut={() => void signOut(boot.session)}
      />
    </SnapbackProvider>
  );
}

const gateStyles = StyleSheet.create({
  screen: { backgroundColor: '#f4efe6', flex: 1, justifyContent: 'center', padding: 22 },
  card: { backgroundColor: '#fffaf1', borderColor: '#ded4c4', borderRadius: 24, borderWidth: 1, gap: 14, padding: 22 },
  eyebrow: { color: '#a34931', fontSize: 10, fontWeight: '900', letterSpacing: 2.1 },
  title: { color: '#23221f', fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontSize: 35, letterSpacing: -0.8 },
  copy: { color: '#6f675d', fontSize: 15, lineHeight: 21, marginBottom: 4 },
  persona: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: '#e5ddcf', borderLeftWidth: 5, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 13 },
  initial: { alignItems: 'center', borderRadius: 99, height: 42, justifyContent: 'center', width: 42 },
  initialText: { color: '#fff', fontSize: 19, fontWeight: '900' },
  personaCopy: { flex: 1, gap: 2 },
  personaName: { color: '#272521', fontSize: 16, fontWeight: '800' },
  personaEmail: { color: '#8a8175', fontSize: 11 },
  arrow: { color: '#71685d', fontSize: 22 },
  error: { backgroundColor: '#fbe7e1', borderRadius: 10, color: '#a23c2b', fontSize: 12, lineHeight: 17, padding: 10 },
  origin: { color: '#92897e', fontSize: 10, marginTop: 4 },
  loading: { alignItems: 'center', gap: 15 },
  loadingText: { color: '#4d4841', fontSize: 16, fontWeight: '700' },
});
