import { useEffect, useState } from 'react';
import { Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { createExternalSessionClient } from '@expo/snapback-client';
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

async function seedSessionWitnessRow({
  fetch: witnessFetch,
  origin,
  bearer,
  capability = null,
  note,
}) {
  const response = await witnessFetch(`${origin}/mutation/seedWitnessRow`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
      ...(capability === null ? {} : { 'x-snapback-dev-identity': capability }),
    },
    body: JSON.stringify({ args: { note }, read_set: [] }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`witness seed mutation returned HTTP ${response.status}`), {
      code: 'SNAPBACK_CHECKOUT_WITNESS_SEED_FAILED',
    });
  }
}

export default function App() {
  const [status, setStatus] = useState('running');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let phase = 'environment';
      const originalFetch = globalThis.fetch;
      const observed = {
        checkoutHeaderPresented: false,
        devIdentityHeaderPresented: false,
        devIdentityAdmissionAccepted: false,
        serverDevIdentityCapabilityWitnessed: false,
        sessionBearerPresented: false,
      };
      const observingFetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const headers = new Headers(init.headers);
        if (url.includes('/_snapback/expo/v1/dev-identity-checkout')) {
          observed.checkoutHeaderPresented = headers.has('x-snapback-dev-identity-checkout');
        }
        if (url.includes('/connection/open')) {
          observed.devIdentityHeaderPresented = headers.has('x-snapback-dev-identity');
        }
        if (url.includes('/query/')) {
          observed.devIdentityHeaderPresented = observed.devIdentityHeaderPresented
            || headers.has('x-snapback-dev-identity');
          observed.sessionBearerPresented = headers.get('authorization')?.startsWith('Bearer ') === true;
        }
        return originalFetch.call(globalThis, input, init);
      };

      try {
        const runtimePlatform = Platform.OS === 'web' ? 'web' : 'native';
        const environment = createSupervisedExpoEnvironment({
          fetch: observingFetch,
          runtimePlatform,
        });
        phase = 'binding';
        const admission = await environment.resolveBinding({ app, signal: controller.signal });
        phase = 'dev-identity';
        const capability = await environment.resolveDevIdentityCapability({
          signal: controller.signal,
        });
        phase = 'authority';
        const authority = await environment.resolveSupervisedAuthority({
          binding: admission.binding,
          signal: controller.signal,
        });
        if (authority.status !== 'ready' || typeof authority.bearer !== 'string') {
          throw Object.assign(new Error('Expo did not receive an ordinary session'), {
            code: 'SNAPBACK_CHECKOUT_WITNESS_SESSION_UNAVAILABLE',
          });
        }
        // @ref LLP 0262#d2-carriers-per-shipped-topology — Expo web keeps its
        //   ordinary session and must neither redeem nor assert native custody.
        if (runtimePlatform === 'web') {
          const client = createExternalSessionClient(admission.binding.target.origin, {
            ...(authority.clientOptions ?? {}),
            bearerToken: authority.bearer,
            rqsStore: null,
            offlineQueue: false,
          });
          let result;
          let directRefusal;
          let directTransportErrorName = null;
          globalThis.fetch = observingFetch;
          try {
            phase = 'web-seed';
            await seedSessionWitnessRow({
              fetch: observingFetch,
              origin: admission.binding.target.origin,
              bearer: authority.bearer,
              note: 'expo-web-supervised-session',
            });
            phase = 'web-query';
            result = await client.query(api.listWitnessRows, { args: {} });
            phase = 'web-direct-refusal';
            try {
              directRefusal = await originalFetch.call(
                globalThis,
                `${admission.binding.target.origin}/connection/open`,
                {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    'x-snapback-auth-client-protocol': '1',
                    'x-snapback-dev-identity': 'sbdev_expo_web_must_not_possess_custody',
                  },
                  body: '{}',
                },
              );
            } catch (error) {
              directTransportErrorName = error?.name ?? 'UnknownError';
            }
          } finally {
            if (globalThis.fetch === observingFetch) globalThis.fetch = originalFetch;
            await client.closeAuth();
          }
          phase = 'web-refusal-body';
          const refusal = directRefusal === undefined ? null : await directRefusal.json();
          if (
            hookInstalledBeforeApplicationModule
            || capability !== null
            || observed.checkoutHeaderPresented !== false
            || observed.devIdentityHeaderPresented
            || !observed.sessionBearerPresented
            || !Array.isArray(result?.rows)
            || result.rows.length < 1
            || !(
              (directRefusal?.status === 403
                && refusal?.diagnostic?.code === 'SNAPBACK_DEV_IDENTITY_REFUSED')
              || (directRefusal === undefined && directTransportErrorName === 'TypeError')
            )
          ) {
            throw Object.assign(new Error('Expo web custody/session facts were incomplete'), {
              code: 'SNAPBACK_CHECKOUT_WITNESS_WEB_FACTS_INCOMPLETE',
            });
          }
          await postReceipt({
            format: 'snapback.expo-dev-identity-witness-app.v1',
            row: 'web-session-isolation',
            status: 'passed',
            hookInstalledBeforeApplicationModule,
            checkoutCapabilityAbsent: true,
            checkoutHeaderPresented: observed.checkoutHeaderPresented,
            devIdentityHeaderPresented: observed.devIdentityHeaderPresented,
            sessionBearerPresented: observed.sessionBearerPresented,
            queryAccepted: true,
            rowCount: result.rows.length,
            directRefusalStatus: directRefusal?.status ?? null,
            directRefusalCode: refusal?.diagnostic?.code ?? null,
            directTransportRefused: directRefusal === undefined,
          });
          setStatus('passed');
          return;
        }
        if (typeof capability !== 'string' || !capability.startsWith('sbdev_')) {
          throw Object.assign(new Error('native checkout did not return a capability'), {
            code: 'SNAPBACK_CHECKOUT_WITNESS_CAPABILITY_UNAVAILABLE',
          });
        }

        const client = createExternalSessionClient(admission.binding.target.origin, {
          ...(authority.clientOptions ?? {}),
          bearerToken: authority.bearer,
          devIdentityCapability: capability,
          rqsStore: null,
          offlineQueue: false,
        });
        let result;
        globalThis.fetch = observingFetch;
        try {
          phase = 'native-dev-identity-admission';
          const connectionGrant = await client.connectionGrant(
            'expo-native-dev-identity-witness',
          );
          observed.serverDevIdentityCapabilityWitnessed =
            connectionGrant.devIdentityCapabilityWitnessed === true;
          observed.devIdentityAdmissionAccepted =
            observed.serverDevIdentityCapabilityWitnessed;
          phase = 'native-seed';
          await seedSessionWitnessRow({
            fetch: observingFetch,
            origin: admission.binding.target.origin,
            bearer: authority.bearer,
            capability,
            note: 'expo-native-supervised-session',
          });
          phase = 'native-query';
          result = await client.query(api.listWitnessRows, {
            args: {},
          });
        } finally {
          if (globalThis.fetch === observingFetch) globalThis.fetch = originalFetch;
          await client.closeAuth();
        }

        if (
          !hookInstalledBeforeApplicationModule
          || !observed.checkoutHeaderPresented
          || !observed.devIdentityHeaderPresented
          || !observed.devIdentityAdmissionAccepted
          || !observed.serverDevIdentityCapabilityWitnessed
          || !observed.sessionBearerPresented
          || !Array.isArray(result?.rows)
          || result.rows.length < 1
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
          devIdentityAdmissionAccepted: observed.devIdentityAdmissionAccepted,
          serverDevIdentityCapabilityWitnessed:
            observed.serverDevIdentityCapabilityWitnessed,
          checkoutRedeemed: true,
          sessionBearerPresented: observed.sessionBearerPresented,
          queryAccepted: true,
          rowCount: result.rows.length,
        });
        setStatus('passed');
      } catch (error) {
        await postReceipt({
          format: 'snapback.expo-dev-identity-witness-app.v1',
          row: Platform.OS === 'web' ? 'web-session-isolation' : 'native-reader',
          status: 'failed',
          hookInstalledBeforeApplicationModule,
          phase,
          errorName: typeof error?.name === 'string' ? error.name : 'UnknownError',
          checkoutHeaderPresented: observed.checkoutHeaderPresented,
          devIdentityHeaderPresented: observed.devIdentityHeaderPresented,
          devIdentityAdmissionAccepted: observed.devIdentityAdmissionAccepted,
          serverDevIdentityCapabilityWitnessed:
            observed.serverDevIdentityCapabilityWitnessed,
          sessionBearerPresented: observed.sessionBearerPresented,
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
        <Text style={styles.title}>Snapback checkout witness</Text>
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
