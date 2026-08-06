import { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  SnapbackExpoProvider,
  useSnapbackExpoBootState,
} from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';

import { app } from './snapback/generated/app.mjs';
import type { Id } from './snapback/generated/api.d.ts';
import { G2DemoProvider } from './src/g2-context';
import InboxScreen from './src/screens/inbox-screen';
import ChatScreen from './src/screens/chat-screen';
import { palette } from './src/palette';

function BootFallback({ state }: Readonly<{ state: ExpoBootState }>) {
  const diagnostic = 'diagnostic' in state ? state.diagnostic : null;
  return (
    <SafeAreaView style={styles.fallback}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>LLP 0176 · G2</Text>
        <Text style={styles.title}>{state.status === 'starting' ? 'Opening Relay Room…' : "Relay Room couldn't start"}</Text>
        <Text testID="provider-status" style={styles.status}>{state.status}</Text>
        {diagnostic ? (
          <Text testID="provider-diagnostic" style={styles.error}>
            {diagnostic.code}: {diagnostic.message}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function G2Screens() {
  useSnapbackExpoBootState();
  const [thread, setThread] = useState<null | { id: Id<'conversations'>; title: string }>(null);
  return thread ? (
    <ChatScreen conversationId={thread.id} title={thread.title} onBack={() => setThread(null)} />
  ) : (
    <InboxScreen onOpen={(id, title) => setThread({ id, title })} />
  );
}

export default function App() {
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <G2DemoProvider><G2Screens /></G2DemoProvider>
    </SnapbackExpoProvider>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: palette.canvas, flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: palette.surface, borderRadius: 18, gap: 10, padding: 22 },
  eyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: palette.ink, fontSize: 24, fontWeight: '900' },
  status: { color: palette.muted, fontSize: 14 },
  error: { color: palette.danger, fontSize: 13, lineHeight: 19 },
});
