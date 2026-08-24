import { useState } from 'react';
import {
  Button,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';
import {
  SnapbackExpoProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';

import { app } from './snapback/generated/app.mjs';
import type { Id } from './snapback/generated/api.d.ts';
import ChatScreen from './src/screens/chat-screen';
import InboxScreen from './src/screens/inbox-screen';
import { palette } from './src/palette';
import { TestPersonaProvider } from './src/test-persona-context';

type Thread = Readonly<{ id: Id<'conversations'>; title: string }>;

// Durable offline retention: register the on-device file store once, at the
// root, before any client is constructed. Native only — expo-file-system
// throws on web at module scope, and the web persistence ladder already
// resolves the browser IndexedDB arm without this registration.
if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

function BootFallback({ state }: Readonly<{ state: ExpoBootState }>) {
  const diagnostic = 'diagnostic' in state ? state.diagnostic : null;
  return (
    <SafeAreaView style={styles.fallback}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {state.status === 'starting' ? 'Opening chat…' : "Chat couldn't start"}
        </Text>
        <Text style={styles.status}>{state.status}</Text>
        {diagnostic ? (
          <Text style={styles.error}>
            {diagnostic.code}: {diagnostic.message}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function AccountEntry() {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const [email, setEmail] = useState('person@example.com');
  const [password, setPassword] = useState('replace-this-password');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  const signUp = async () => {
    setRecoveryCodes(null);
    const result = await auth.signUpWithPassword({ email, password });
    setRecoveryCodes(result.recoveryCodes);
  };
  const signIn = async () => {
    setRecoveryCodes(null);
    await auth.signInWithPassword({ email, password });
  };
  const signOut = async () => {
    setRecoveryCodes(null);
    await auth.signOut();
  };

  return (
    <View style={styles.accountCard}>
      <Text style={styles.accountTitle}>Account</Text>
      <Text style={styles.status}>
        {principal.status === 'authenticated'
          ? `Signed in as ${principal.userId}`
          : principal.status === 'anonymous'
            ? 'Ready to sign up or sign in'
            : `Authentication: ${principal.status}`}
      </Text>
      {principal.status === 'anonymous' ? (
        <>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            style={styles.input}
            value={email}
          />
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="current-password"
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <View style={styles.accountActions}>
            <Button title="Sign up" onPress={() => void signUp()} />
            <Button title="Sign in" onPress={() => void signIn()} />
          </View>
        </>
      ) : null}
      {principal.status === 'authenticated'
        ? <Button title="Sign out" onPress={() => void signOut()} />
        : null}
      {recoveryCodes ? (
        <View>
          <Text style={styles.recoveryTitle}>
            Save these recovery codes now. They are shown once.
          </Text>
          <Text selectable style={styles.recoveryCodes}>{recoveryCodes.join('\n')}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  const [thread, setThread] = useState<Thread | null>(null);
  return (
    <SnapbackExpoProvider app={app} url={process.env.EXPO_PUBLIC_SNAPBACK_URL} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <TestPersonaProvider>
        <AccountEntry />
        {thread
          ? <ChatScreen conversationId={thread.id} title={thread.title} onBack={() => setThread(null)} />
          : <InboxScreen onOpen={(id, title) => setThread({ id, title })} />}
      </TestPersonaProvider>
    </SnapbackExpoProvider>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: palette.canvas, flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: palette.surface, borderRadius: 18, gap: 10, padding: 22 },
  title: { color: palette.ink, fontSize: 24, fontWeight: '900' },
  status: { color: palette.muted, fontSize: 14 },
  error: { color: palette.danger, fontSize: 12 },
  accountCard: { backgroundColor: palette.surface, gap: 8, padding: 14 },
  accountTitle: { color: palette.ink, fontSize: 18, fontWeight: '800' },
  accountActions: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: palette.canvas, borderRadius: 8, color: palette.ink, padding: 10 },
  recoveryTitle: { color: palette.ink, fontWeight: '700' },
  recoveryCodes: { color: palette.muted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
