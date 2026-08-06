import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { backend } from '@/backend';
import { colors } from '@tandem/shared/colors';
import { DemoViewerProvider } from '@tandem/shared/viewer';

export default function RootLayout() {
  return (
    <backend.Root>
      <DemoViewerProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Messages' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Conversation' }} />
        </Stack>
      </DemoViewerProvider>
    </backend.Root>
  );
}
