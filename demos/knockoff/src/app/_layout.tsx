import { Link } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import * as ExpoCrypto from 'expo-crypto';
import { SnapbackProvider } from '@knockoff/snapback-react';
import type { AuthBootstrapSnapshot } from '@expo/snapback-client';
import { Pressable, Text, View } from 'react-native';

import { app } from '@generated/app.mjs';
import { QueryState } from '@/components/query-state';
import { SocialEntry } from '@/components/social-entry';
import { colors } from '@/theme/colors';

const issuedAt = new Date();
const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4287';
const binding = Object.freeze({
  format: 'snapback.app-binding.v1' as const,
  source: 'supervised-dev' as const,
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin,
    routing: 'loopback' as const,
  }),
  capabilities: Object.freeze({ offered: Object.freeze([...app.capabilities.required].sort()) }),
  provenance: Object.freeze({
    supervisorGeneration: `knockoff-local-${app.identity.descriptor}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 12 * 60 * 60_000).toISOString(),
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' as const }),
});
const cryptoObject = Object.freeze({
  subtle: Object.freeze({
    digest(algorithm: AlgorithmIdentifier, data: BufferSource) {
      if (algorithm !== 'SHA-256') throw new Error(`Unsupported digest algorithm ${String(algorithm)}`);
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
    },
  }),
}) as unknown as Crypto;
const platform = Object.freeze({ kind: 'memory' as const, cryptoObject });

export default function RootLayout() {
  return <SnapbackProvider
    app={app}
    binding={binding}
    platform={platform}
    fallback={(state: AuthBootstrapSnapshot) => <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
      <QueryState
        message={state.status === 'starting' ? 'Opening Knockoff…' : "Knockoff couldn't start"}
        error={'diagnostic' in state ? new Error(`${state.diagnostic.code}: ${state.diagnostic.message}`) : undefined}
      />
    </View>}
  >
    <SocialEntry>
      <StatusBar style="auto" />
      <Stack screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="compose" options={{ presentation: 'formSheet', sheetGrabberVisible: true, title: 'New post' }} />
        <Stack.Screen name="profile/[handle]" options={{
          title: 'Profile',
          headerLeft: () => <Link href="/" asChild>
            <Pressable accessibilityLabel="Back to feed" hitSlop={10}>
              <Text style={{ color: colors.accent, fontSize: 16 }}>‹ Feed</Text>
            </Pressable>
          </Link>,
        }} />
      </Stack>
    </SocialEntry>
  </SnapbackProvider>;
}
