import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { RelayProvider } from '@/providers/relay-provider';
import { palette } from '@/theme/colors';

export default function RootLayout() {
  return (
    <RelayProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{
        contentStyle: { backgroundColor: palette.canvas },
        headerBackTitle: 'Chats',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.accent,
      }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Conversation' }} />
      </Stack>
    </RelayProvider>
  );
}
