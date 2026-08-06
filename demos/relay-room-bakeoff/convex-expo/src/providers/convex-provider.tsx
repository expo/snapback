import 'expo-sqlite/localStorage/install';
import { ConvexProvider, ConvexReactClient, useMutation } from 'convex/react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import { colors } from '@/theme/colors';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url, { unsavedChangesWarning: false }) : null;
const PERSONA_KEY = 'relay-room.convex.persona';

type PersonaContextValue = Readonly<{
  activeHandle: string;
  setActiveHandle: (handle: string) => void;
}>;

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function RelayConvexProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeHandle, setHandle] = useState(() => globalThis.localStorage?.getItem(PERSONA_KEY) ?? 'ada');
  const value = useMemo(() => ({
    activeHandle,
    setActiveHandle(handle: string) {
      globalThis.localStorage?.setItem(PERSONA_KEY, handle);
      setHandle(handle);
    },
  }), [activeHandle]);

  if (!convex) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Missing EXPO_PUBLIC_CONVEX_URL</Text>
        <Text selectable style={styles.detail}>Run `bunx convex dev` to create `.env.local`, then restart Expo.</Text>
      </View>
    );
  }

  return (
    <ConvexProvider client={convex}>
      <SeedOnce />
      <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>
    </ConvexProvider>
  );
}

function SeedOnce() {
  const seed = useMutation(api.relay.seed);
  const [phase, setPhase] = useState<'pending' | 'ready' | 'error'>('pending');
  useEffect(() => {
    void seed({}).then(() => setPhase('ready'), () => setPhase('error'));
  }, [seed]);
  if (phase === 'pending') return <View style={styles.seed}><ActivityIndicator color={colors.accent} /><Text style={styles.seedText}>Checking sample data…</Text></View>;
  if (phase === 'error') return <View style={styles.seed}><Text style={styles.error}>Could not seed sample data.</Text></View>;
  return null;
}

export function usePersona() {
  const value = useContext(PersonaContext);
  if (!value) throw new Error('usePersona must be inside RelayConvexProvider');
  return value;
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', backgroundColor: colors.canvas, flex: 1, gap: 10, justifyContent: 'center', padding: 24 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  detail: { color: colors.muted, textAlign: 'center' },
  seed: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', gap: 8, justifyContent: 'center', padding: 7 },
  seedText: { color: colors.muted, fontSize: 11 },
  error: { color: colors.danger, fontSize: 11 },
});
