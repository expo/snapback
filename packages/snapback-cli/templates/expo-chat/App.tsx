import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { SnapbackExpoProvider } from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';

import { app } from './snapback/generated/app.mjs';
import type { Id } from './snapback/generated/api.d.ts';
import ChatScreen from './src/screens/chat-screen';
import { palette } from './src/palette';

// The seeded conversation and persona this starter opens with. Swap these for
// your own navigation and session-derived identity as the app grows.
const CONVERSATION_ID = 'conversation_engine_room' as Id<'conversations'>;
const ACTIVE_USER_ID = 'user_ada' as Id<'users'>;

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
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <ChatScreen conversationId={CONVERSATION_ID} activeUserId={ACTIVE_USER_ID} />
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
