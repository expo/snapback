import { useEffect, useState } from 'react';
import type { ReactBindingDevelopmentSyncState } from '@expo/snapback-client';
import { SnapbackProvider } from '@chirp/snapback-react';
import { Link } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { QueryState } from '@/components/query-state';
import { createProvider } from '@/lib/snapback';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  const [state, setState] = useState<{
    provider?: Awaited<ReturnType<typeof createProvider>>;
    sync?: ReactBindingDevelopmentSyncState;
    error?: unknown;
  }>({});
  useEffect(() => {
    let mounted = true;
    createProvider((sync) => {
      if (mounted) setState((current) => ({ ...current, sync }));
    }).then(
      (provider) => {
        if (mounted) setState({ provider });
        else void provider.dispose();
      },
      (error) => {
        if (mounted) setState((current) => ({ ...current, error }));
      },
    );
    return () => { mounted = false; };
  }, []);
  if (!state.provider) {
    const developerDetails = state.sync?.status === 'timed-out'
      ? {
          code: state.sync.diagnostic.code,
          actions: state.sync.actions,
        }
      : undefined;
    return <QueryState
      message={state.sync?.message ?? 'Connecting to Snapback…'}
      error={state.error}
      developerDetails={developerDetails}
    />;
  }
  return <SnapbackProvider provider={state.provider}>
    <StatusBar style="auto" />
    <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ presentation: 'formSheet', sheetGrabberVisible: true, title: 'New post' }} />
      <Stack.Screen name="profile/[handle]" options={{
        title: 'Profile',
        headerLeft: () => <Link href="/" asChild>
          <Pressable accessibilityLabel="Back to timeline" hitSlop={10}>
            <Text style={{ color: colors.blue, fontSize: 16 }}>‹ Home</Text>
          </Pressable>
        </Link>,
      }} />
    </Stack>
  </SnapbackProvider>;
}
