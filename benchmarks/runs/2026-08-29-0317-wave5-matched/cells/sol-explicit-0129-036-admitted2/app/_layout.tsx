import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SnapbackExpoProvider } from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';
import { app } from '../snapback/generated/app.mjs';

function Boot({ state }: { state: ExpoBootState }) {
  const diagnostic = 'diagnostic' in state ? state.diagnostic : null;
  return (
    <View style={styles.boot}>
      <Text style={styles.brand}>Clique</Text>
      <Text>{state.status === 'starting' ? 'Connecting…' : "Clique couldn't start"}</Text>
      {diagnostic ? <Text style={styles.error}>{diagnostic.code}: {diagnostic.message}</Text> : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SnapbackExpoProvider
      app={app}
      url={process.env.EXPO_PUBLIC_SNAPBACK_URL}
      fallback={(state: ExpoBootState) => <Boot state={state} />}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </SnapbackExpoProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F7F8FC' },
  brand: { fontSize: 36, fontWeight: '800', color: '#4F46E5' },
  error: { color: '#B42318', maxWidth: 560, textAlign: 'center' },
});
