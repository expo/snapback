import { useState } from 'react';
import { Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';
import { SnapbackExpoProvider } from '@expo/snapback-expo';
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

export default function App() {
  const [thread, setThread] = useState<Thread | null>(null);
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <TestPersonaProvider>
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
});
