import { useEffect, useState } from 'react';
import type { ReactBindingDevelopmentSyncState } from '@expo/snapback-client';
import { SnapbackProvider } from '@expo/snapback-react';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { QueryState } from '@/components/query-state';
import { createProvider } from '@/lib/snapback';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  const [state, setState] = useState<{ provider?: Awaited<ReturnType<typeof createProvider>>; sync?: ReactBindingDevelopmentSyncState; error?: unknown }>({});
  useEffect(() => { let mounted = true; createProvider((sync) => mounted && setState((current) => ({ ...current, sync }))).then((provider) => mounted ? setState({ provider }) : void provider.dispose(), (error) => mounted && setState((current) => ({ ...current, error }))); return () => { mounted = false; }; }, []);
  if (!state.provider) return <QueryState message={state.sync?.message ?? 'Opening the victory jar…'} error={state.error} />;
  return <SnapbackProvider provider={state.provider}><StatusBar style="dark" /><Stack screenOptions={{ headerLargeTitle: true, headerShadowVisible: false, contentStyle: { backgroundColor: colors.canvas } }}><Stack.Screen name="index" options={{ title: 'Tiny Triumphs' }} /></Stack></SnapbackProvider>;
}
