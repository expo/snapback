import { useEffect, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';
import { Slot } from 'expo-router';
import {
  SnapbackExpoProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';
import { AuthForm } from '@snapback-bench/social-ui';
import { palette, spacing, typeScale } from '@snapback-bench/social-ui';

import { app } from '../snapback/generated/app.mjs';
import { Chrome } from '../src/ui/Chrome';
import { diagnosticText } from '../src/lib/snapback';

if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

function BootFallback({ state }: Readonly<{ state: ExpoBootState }>) {
  const diagnostic = 'diagnostic' in state ? state.diagnostic : null;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const recover = () => {
      if (!(window as { __cliqueBootReload?: boolean }).__cliqueBootReload) {
        (window as { __cliqueBootReload?: boolean }).__cliqueBootReload = true;
        window.location.reload();
      }
    };
    const onOnline = () => recover();
    window.addEventListener('online', onOnline);
    const timer = setInterval(async () => {
      try {
        await fetch(`${window.location.origin}/?clique-boot=${Date.now()}`, { cache: 'no-store' });
        if (state.status === 'error' || state.status === 'blocked') recover();
      } catch {
        /* still offline */
      }
    }, 1000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [state.status]);
  return (
    <SafeAreaView style={styles.fallback}>
      <Text style={styles.title}>{state.status === 'starting' ? 'Opening Clique…' : "Clique couldn't start"}</Text>
      <Text style={styles.status}>{state.status}</Text>
      {diagnostic ? <Text style={styles.error}>{diagnostic.code}: {diagnostic.message}</Text> : null}
    </SafeAreaView>
  );
}

function Gate() {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorText, setErrorText] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (nextEmail: string, nextPassword: string) => {
    setSubmitting(true);
    setErrorText(undefined);
    try {
      if (mode === 'sign-up') {
        await auth.signUpWithPassword({ email: nextEmail, password: nextPassword });
      } else {
        await auth.signInWithPassword({ email: nextEmail, password: nextPassword });
      }
    } catch (error) {
      const text = diagnosticText(error) ?? 'Sign-in failed';
      if (mode === 'sign-up' && /already|exists|duplicate|taken/i.test(text)) {
        setErrorText('That email is already registered.');
      } else {
        setErrorText(text);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (principal.status === 'loading' || principal.status === 'refreshing') {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.status}>Loading session…</Text>
      </SafeAreaView>
    );
  }

  if (principal.status !== 'authenticated') {
    if (Platform.OS === 'web') {
      return (
        <SafeAreaView style={styles.fallback}>
          <View style={{ padding: 24, maxWidth: 420, alignSelf: 'center' }}>
            <Text style={styles.title}>Clique</Text>
            <input
              data-testid="sm-auth-email"
              aria-label="Email"
              autoCapitalize="none"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              placeholder="Email"
              style={{ display: 'block', width: '100%', marginBottom: 12, padding: 12 }}
            />
            <input
              data-testid="sm-auth-password"
              aria-label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="Password"
              style={{ display: 'block', width: '100%', marginBottom: 12, padding: 12 }}
            />
            {errorText ? <Text style={styles.error} testID="sm-auth-error">{errorText}</Text> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void onSubmit(email, password)}
              testID="sm-auth-submit"
              style={{ backgroundColor: '#4F46E5', padding: 12, alignItems: 'center', borderRadius: 8 }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>{mode === 'sign-up' ? 'Sign up' : 'Sign in'}</Text>
            </Pressable>
            <Pressable testID="sm-auth-toggle" onPress={() => setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))}>
              <Text style={styles.status}>{mode === 'sign-up' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.fallback}>
        <AuthForm
          mode={mode}
          email={email}
          password={password}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onSubmit={onSubmit}
          onToggleMode={() => setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))}
          errorText={errorText}
          submitting={submitting}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell}>
      <Chrome>
        <Slot />
      </Chrome>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  return (
    <SnapbackExpoProvider
      app={app}
      url={process.env.EXPO_PUBLIC_SNAPBACK_URL}
      fallback={(state: ExpoBootState) => <BootFallback state={state} />}
    >
      <Gate />
    </SnapbackExpoProvider>
  );
}

const styles = StyleSheet.create({
  fallback: { flex: 1, backgroundColor: palette.background, justifyContent: 'center' },
  shell: { flex: 1, backgroundColor: palette.background },
  title: { ...typeScale.title, color: palette.text, textAlign: 'center', marginBottom: spacing.sm },
  status: { ...typeScale.body, color: palette.textMuted, textAlign: 'center' },
  error: { ...typeScale.footnote, color: palette.danger, textAlign: 'center', marginTop: spacing.md },
});
