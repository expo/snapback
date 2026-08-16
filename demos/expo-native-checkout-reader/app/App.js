import { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { SnapbackClient } from '@expo/snapback-client';
import { createSupervisedExpoEnvironment } from '@expo/snapback-expo/supervised-environment';

import api, { app } from './snapback/generated/api.mjs';

const hookInstalledBeforeApplicationModule =
  typeof globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__ === 'string'
  && globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__.length > 0;

function receiptOrigin() {
  const value = process.env.EXPO_PUBLIC_SNAPBACK_CHECKOUT_WITNESS_ORIGIN;
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error('witness receipt origin is unavailable'), {
      code: 'SNAPBACK_CHECKOUT_WITNESS_ORIGIN_UNAVAILABLE',
    });
  }
  return value;
}

async function postReceipt(receipt) {
  await fetch(`${receiptOrigin()}/receipt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(receipt),
  });
}

export default function App() {
  const [status, setStatus] = useState('running');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const originalFetch = globalThis.fetch;
      const observed = {
        checkoutHeaderPresented: false,
        devIdentityHeaderPresented: false,
      };
      const observingFetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const headers = new Headers(init.headers);
        if (url.includes('/_snapback/expo/v1/dev-identity-checkout')) {
          observed.checkoutHeaderPresented = headers.has('x-snapback-dev-identity-checkout');
        }
        if (url.includes('/query/')) {
          observed.devIdentityHeaderPresented = headers.has('x-snapback-dev-identity');
        }
        return originalFetch.call(globalThis, input, init);
      };

      try {
        const environment = createSupervisedExpoEnvironment({
          fetch: observingFetch,
          runtimePlatform: 'native',
        });
        const admission = await environment.resolveBinding({ app, signal: controller.signal });
        const capability = await environment.resolveDevIdentityCapability({
          signal: controller.signal,
        });
        if (typeof capability !== 'string' || !capability.startsWith('sbdev_')) {
          throw Object.assign(new Error('native checkout did not return a capability'), {
            code: 'SNAPBACK_CHECKOUT_WITNESS_CAPABILITY_UNAVAILABLE',
          });
        }

        const client = new SnapbackClient(admission.binding.target.origin, {
          devIdentityCapability: capability,
          rqsStore: null,
          offlineQueue: false,
        });
        let result;
        globalThis.fetch = observingFetch;
        try {
          result = await client.query(api.listWitnessRows, {
            args: {},
            userId: 'native-checkout-witness',
          });
        } finally {
          if (globalThis.fetch === observingFetch) globalThis.fetch = originalFetch;
          await client.closeAuth();
        }

        if (
          !hookInstalledBeforeApplicationModule
          || !observed.checkoutHeaderPresented
          || !observed.devIdentityHeaderPresented
          || !Array.isArray(result?.rows)
        ) {
          throw Object.assign(new Error('native checkout witness facts were incomplete'), {
            code: 'SNAPBACK_CHECKOUT_WITNESS_FACTS_INCOMPLETE',
          });
        }

        await postReceipt({
          format: 'snapback.expo-dev-identity-witness-app.v1',
          row: 'native-reader',
          status: 'passed',
          hookInstalledBeforeApplicationModule,
          checkoutHeaderPresented: observed.checkoutHeaderPresented,
          devIdentityHeaderPresented: observed.devIdentityHeaderPresented,
          checkoutRedeemed: true,
          queryAccepted: true,
          rowCount: result.rows.length,
        });
        setStatus('passed');
      } catch (error) {
        await postReceipt({
          format: 'snapback.expo-dev-identity-witness-app.v1',
          row: 'native-reader',
          status: 'failed',
          hookInstalledBeforeApplicationModule,
          code: typeof error?.code === 'string' ? error.code : 'SNAPBACK_CHECKOUT_WITNESS_FAILED',
        }).catch(() => {});
        setStatus('failed');
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Snapback native checkout witness</Text>
        <Text testID="witness-status" style={styles.status}>{status}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#f4f1e8', flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#ffffff', borderRadius: 18, gap: 12, padding: 24 },
  title: { color: '#191919', fontSize: 22, fontWeight: '700' },
  status: { color: '#395c43', fontSize: 16, fontWeight: '600' },
});
