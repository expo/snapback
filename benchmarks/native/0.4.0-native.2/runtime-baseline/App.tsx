import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { configuration, observe } from 'clique-native-observer';
import { AuthForm } from './ui/src/AuthForm';

const OBSERVER = configuration();
const SESSION_KEY = 'clique.runtime.baseline.session';
const ORIGIN = 'runtime-baseline://local';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [principal, setPrincipal] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'auth' | 'written' | 'restored' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(SESSION_KEY);
        if (!current) return;
        if (stored) {
          const session = JSON.parse(stored);
          setPrincipal(session.principal);
          setPhase('restored');
          observe('ready', {
            principal: session.principal,
            origin: ORIGIN,
            authenticationRestored: true,
            build: OBSERVER?.build ?? 'runtime-baseline',
            development: __DEV__,
          });
        } else {
          setPhase('auth');
        }
      } catch (cause) {
        if (!current) return;
        setError(String(cause));
        setPhase('error');
      }
    })();
    return () => { current = false; };
  }, []);

  async function signIn() {
    try {
      const session = { principal: email.trim(), signedInAt: new Date().toISOString() };
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
      const stored = await SecureStore.getItemAsync(SESSION_KEY);
      if (!stored || JSON.parse(stored).principal !== session.principal) {
        throw new Error('SecureStore read-after-write mismatch');
      }
      setPrincipal(session.principal);
      setPhase('written');
      observe('ready', {
        principal: session.principal,
        origin: ORIGIN,
        authenticationRestored: true,
        build: OBSERVER?.build ?? 'runtime-baseline',
        development: __DEV__,
      });
    } catch (cause) {
      setError(String(cause));
      setPhase('error');
    }
  }

  async function reset() {
    try {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      setEmail(''); setPassword(''); setPrincipal(null); setError(''); setPhase('auth');
    } catch (cause) {
      setError(String(cause)); setPhase('error');
    }
  }

  return <View style={{ flex: 1, paddingTop: 80, paddingHorizontal: 24, backgroundColor: 'white' }}>
    <Text accessibilityRole="header" style={{ fontSize: 24, marginBottom: 24 }}>Native runtime baseline</Text>
    {phase === 'loading' ? <Text testID="runtime-secure-loading">Loading</Text> : null}
    {phase === 'auth' ? <AuthForm
      mode="sign-in"
      email={email}
      password={password}
      onChangeEmail={setEmail}
      onChangePassword={setPassword}
      onSubmit={signIn}
      appName="Runtime baseline"
    /> : null}
    {phase === 'written' ? <Text testID="runtime-secure-write-read" accessibilityValue={{ text: principal ?? '' }}>
      SecureStore write and read completed for {principal}
    </Text> : null}
    {phase === 'restored' ? <Text testID="runtime-secure-restored" accessibilityValue={{ text: principal ?? '' }}>
      SecureStore restored {principal} after relaunch
    </Text> : null}
    {phase === 'error' ? <Text testID="runtime-secure-error">{error}</Text> : null}
    {phase !== 'loading' ? <Pressable
      testID="runtime-secure-reset"
      accessibilityRole="button"
      onPress={reset}
      style={{ marginTop: 24, padding: 12, backgroundColor: '#eee' }}
    ><Text>Reset stored session</Text></Pressable> : null}
  </View>;
}
