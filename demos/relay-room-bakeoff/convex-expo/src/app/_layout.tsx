import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { RelayConvexProvider } from '@/providers/convex-provider';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  return (
    <RelayConvexProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{
        contentStyle: { backgroundColor: colors.canvas },
        headerBackTitle: 'Chats',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.accent,
      }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Conversation' }} />
      </Stack>
    </RelayConvexProvider>
  );
}
