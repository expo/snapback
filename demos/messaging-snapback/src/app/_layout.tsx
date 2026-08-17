import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { ReactBindingDevelopmentSyncState } from '@expo/snapback-client';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';
import { SnapbackProvider } from '@messenger/snapback-react';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { QueryState } from '@/components/query-state';
import { createProvider } from '@/lib/snapback';
import { IdentityProvider } from '@/lib/identity';
import { colors } from '@/theme/colors';

// Native only — expo-file-system has no web implementation. This registers
// the on-device durable store; skipping it on web just leaves the client on
// the (also fine) IndexedDB arm. Not load-bearing for this demo's product
// claims (no offline-first UI), but the paved boot sequence either way.
if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

export default function RootLayout() {
  const [state, setState] = useState<{
    runtime?: Awaited<ReturnType<typeof createProvider>>;
    sync?: ReactBindingDevelopmentSyncState;
    error?: unknown;
  }>({});

  useEffect(() => {
    let mounted = true;
    createProvider((sync) => {
      if (mounted) setState((current) => ({ ...current, sync }));
    }).then(
      (runtime) => {
        if (mounted) setState({ runtime });
        else void runtime.provider.dispose();
      },
      (error) => {
        if (mounted) setState((current) => ({ ...current, error }));
      },
    );
    return () => { mounted = false; };
  }, []);

  if (!state.runtime) {
    return <QueryState message={state.sync?.message ?? 'Connecting to Snapback…'} error={state.error} />;
  }

  return (
    <SnapbackProvider provider={state.runtime.provider}>
      <IdentityProvider client={state.runtime.client}>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="conversation/[id]" options={{ headerTitle: '' }} />
          <Stack.Screen
            name="new-group"
            options={{ presentation: 'formSheet', sheetGrabberVisible: true, title: 'New group' }}
          />
        </Stack>
      </IdentityProvider>
    </SnapbackProvider>
  );
}
