import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SnapbackExpoProvider,
  useSnapbackExpoBootState,
} from '@expo/snapback-expo';
import type {
  AppBindingV1,
  ExpoBootState,
  SnapbackExpoEnvironmentV1,
} from '@expo/snapback-expo';

import { app } from './probe-app';
import { resolveNativeAppClientPlatform } from './native-platform';
import {
  bootstrapPublicProjection,
  executeProbeCommand,
  installBootstrapInvoker,
  installMilestoneRenderer,
  ProbeRuntime,
  readPublicCustodyFacts,
  resetRuntimeProjection,
} from './probe-runtime';
import { fetchDirectorConfig, startWitness } from './witness';

type BootRequest = Readonly<{ generation: number; mode: string }>;
type PendingBoot = {
  generation: number;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};
type Milestone = Readonly<{
  name: string;
  launchId: string;
  custodyRevision: number | null;
  bearerSha256Prefix: string;
  principalId: string;
}>;

const launchId = `${Platform.OS}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function terminal(state: ExpoBootState) {
  return !['starting', 'ready'].includes(state.status);
}

export default function App() {
  const [request, setRequest] = useState<BootRequest | null>(null);
  const [status, setStatus] = useState('starting witness');
  const [milestone, setMilestone] = useState<Milestone>({
    name: 'not-captured',
    launchId,
    custodyRevision: null,
    bearerSha256Prefix: 'none',
    principalId: 'unavailable',
  });
  const pending = useRef<PendingBoot | null>(null);
  const generation = useRef(0);

  const settleBoot = useCallback(async (state: ExpoBootState) => {
    const waiter = pending.current;
    if (waiter === null || waiter.generation !== request?.generation) return;
    clearTimeout(waiter.timer);
    pending.current = null;
    try {
      const custodyFacts = state.status === 'ready' ? await readPublicCustodyFacts() : null;
      waiter.resolve(Object.freeze({
        mode: request.mode,
        ...bootstrapPublicProjection(state as unknown as Readonly<Record<string, unknown>>),
        custodyFacts,
      }));
    } catch (error) {
      waiter.reject(error);
    }
  }, [request]);

  useEffect(() => {
    installMilestoneRenderer((next) => setMilestone(next as Milestone), launchId);
    installBootstrapInvoker((mode) => {
      if (!['native', 'ordinary'].includes(mode)) {
        return Promise.reject(Object.assign(new Error(`unknown bootstrap mode ${mode}`), {
          code: 'SNAPBACK_NATIVE_PROBE_BOOTSTRAP_MODE_UNKNOWN',
        }));
      }
      resetRuntimeProjection();
      if (pending.current !== null) {
        clearTimeout(pending.current.timer);
        pending.current.reject(Object.assign(new Error('bootstrap superseded'), {
          code: 'SNAPBACK_NATIVE_PROBE_BOOTSTRAP_SUPERSEDED',
        }));
      }
      generation.current += 1;
      const next = Object.freeze({ generation: generation.current, mode });
      setRequest(next);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.current?.generation !== next.generation) return;
          pending.current = null;
          reject(Object.assign(new Error(`bootstrap ${mode} timed out`), {
            code: 'SNAPBACK_NATIVE_PROBE_BOOTSTRAP_TIMEOUT',
          }));
        }, 30_000);
        pending.current = { generation: next.generation, resolve, reject, timer };
      });
    });
    void startWitness(launchId, executeProbeCommand, setStatus);
    return () => {
      if (pending.current !== null) clearTimeout(pending.current.timer);
    };
  }, []);

  const environment = useMemo(() => {
    if (request === null) return null;
    const value: SnapbackExpoEnvironmentV1 = {
      format: 'snapback.expo-environment.v1',
      appState: AppState,
      async resolveBinding() {
        const config = await fetchDirectorConfig() as { binding?: AppBindingV1 };
        if (config.binding === undefined) {
          throw Object.assign(new Error('director config carries no binding'), {
            code: 'SNAPBACK_APP_BINDING_UNAVAILABLE',
          });
        }
        return {
          binding: config.binding,
          admission: { delivery: { channel: 'local-supervised-ipc' } },
        };
      },
      // Required by the environment contract. Capability-gated application
      // bootstrap never calls legacy authority adoption.
      adoptAuthority() {
        return {
          status: 'authority-required' as const,
          diagnostic: {
            schemaVersion: 'snapback.client-diagnostic.v1' as const,
            code: 'SNAPBACK_AUTHORITY_REQUIRED',
            severity: 'error' as const,
            message: 'Native custody probes use first-party application bootstrap.',
            details: Object.freeze({}),
          },
          remediations: Object.freeze([]),
        };
      },
      ...(request.mode === 'native'
        ? { resolveAppClientPlatform: () => resolveNativeAppClientPlatform() }
        : {}),
    };
    return Object.freeze(value);
  }, [request]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>LLP 0258 · Phase 2</Text>
        <Text style={styles.title}>Native custody probe</Text>
        <Text testID="probe-platform" style={styles.fact}>{Platform.OS}</Text>
        <Text testID="probe-status" style={styles.status}>{status}</Text>
        <Text testID="probe-milestone" style={styles.fact}>milestone: {milestone.name}</Text>
        <Text testID="probe-launch" style={styles.fact}>launch: {milestone.launchId}</Text>
        <Text testID="probe-revision" style={styles.fact}>revision: {milestone.custodyRevision ?? 'none'}</Text>
        <Text testID="probe-bearer-sha" style={styles.fact}>bearer sha256: {milestone.bearerSha256Prefix}</Text>
        <Text testID="probe-principal" style={styles.fact}>principal: {milestone.principalId}</Text>
        {request !== null && environment !== null ? (
          <SnapbackExpoProvider
            key={`${request.generation}:${request.mode}`}
            app={app}
            environment={environment}
            fallback={(state: ExpoBootState) => (
              <BootFallback state={state} settle={settleBoot} />
            )}
          >
            <ProbeRuntime />
            <ReadyObserver settle={settleBoot} />
          </SnapbackExpoProvider>
        ) : (
          <Text style={styles.fact}>Awaiting bootstrap command</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function BootFallback({
  state,
  settle,
}: Readonly<{ state: ExpoBootState; settle(state: ExpoBootState): Promise<void> }>) {
  useEffect(() => {
    if (terminal(state)) void settle(state);
  }, [state, settle]);
  return (
    <View>
      <Text testID="boot-status" style={styles.fact}>{state.status}</Text>
      {'diagnostic' in state ? (
        <Text testID="boot-diagnostic" style={styles.refusal}>{state.diagnostic.code}</Text>
      ) : null}
    </View>
  );
}

function ReadyObserver({ settle }: Readonly<{ settle(state: ExpoBootState): Promise<void> }>) {
  const state = useSnapbackExpoBootState();
  useEffect(() => {
    if (state.status === 'ready') {
      const timer = setTimeout(() => { void settle(state); }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state, settle]);
  return <Text testID="boot-status" style={styles.success}>ready</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08131f', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#10263a', borderRadius: 24, gap: 12, padding: 24 },
  eyebrow: { color: '#76d7c4', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#f4fbff', fontSize: 30, fontWeight: '900' },
  fact: { color: '#b8cad7', fontSize: 15 },
  status: { color: '#f7c96b', fontSize: 15, fontWeight: '700' },
  success: { color: '#72e0a2', fontSize: 15, fontWeight: '800' },
  refusal: { color: '#ff8e86', fontSize: 13, fontWeight: '700' },
});
