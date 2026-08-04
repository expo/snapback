import { useEffect, useState } from 'react';
import { SnapbackProvider } from '@chirp/snapback-react';
import { Link } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { QueryState } from '@/components/query-state';
import { createProvider } from '@/lib/snapback';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  const [state, setState] = useState<{ provider?: Awaited<ReturnType<typeof createProvider>>; error?: unknown }>({});
  useEffect(() => { createProvider().then((provider) => setState({ provider }), (error) => setState({ error })); }, []);
  if (!state.provider) return <QueryState message="Connecting to Snapback…" error={state.error} />;
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
