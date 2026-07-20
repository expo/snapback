import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SnapbackClient } from '@snapback/client';
import { useSnapbackQuery } from '@partitime/snapback-react';

import api from '@partitime/generated-api';

// @ref LLP 0012#react-and-expo-requirements — Expo consumes the same
// generated function references and external-store lifecycle as React web;
// this carrier claims Online only and never claims local handler execution.
// @ref LLP 0063#workstream-2--first-class-react-expo-and-vanilla-projections —
// the native proof exposes launch, OS lifecycle, auth rotation, reconnect,
// optimistic settlement, and capability honesty as machine-readable events.

// Android acceptance installs an explicit `adb reverse` bridge, preserving
// Snapback's loopback-only dev-auth transport posture on both OS profiles.
const host = '127.0.0.1';
const snapbackOrigin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? `http://${host}:18763`;
const witnessOrigin = process.env.EXPO_PUBLIC_PARTITIME_WITNESS_ORIGIN ?? `http://${host}:18764`;
const carrierLaunchId = `${Platform.OS}-${Date.now()}`;
let reportTail = Promise.resolve();
const report = (event, details = {}) => {
  const body = JSON.stringify({
    schemaVersion: 'partitime.native-event.v1',
    profileId: `react-expo/${Platform.OS}`,
    capabilityClass: 'Online',
    launchId: carrierLaunchId,
    event,
    details,
    atMs: Date.now(),
  });
  const delivery = reportTail.then(async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${witnessOrigin}/event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return;
      } catch { /* retry the witness without coupling it to data transport */ }
      if (attempt < 3) await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 50));
    }
  });
  reportTail = delivery.catch(() => {});
  return delivery;
};

async function createProvider() {
  const client = new SnapbackClient(snapbackOrigin);
  await client.health();
  let sequence = 0;
  let deliverySequence = 0;
  let active = true;
  const subscriptions = new Set();

  const deliverAuthoritative = (record, rows, connection) => {
    record.rows = [...(rows ?? [])];
    record.connection = connection;
    deliverySequence += 1;
    void report('authoritative-snapshot', {
      name: record.name,
      userId: record.userId,
      rowCount: record.rows.length,
      rowIds: record.rows.map((row) => row._id),
      rowTitles: record.rows.map((row) => row.title),
      deliverySequence,
      attempt: record.attempt,
    });
    record.observer(record.rows, connection, { kind: 'authoritative' });
  };

  const startRecord = async (record) => {
    if (!active || record.disposed) return;
    const generation = record.generation += 1;
    record.attempt += 1;
    const handle = await client.liveQuery(api[record.name], {
      args: record.args,
      userId: record.userId,
      transport: 'stream',
      fallbackToPoll: false,
      stream: {
        // React Native can leave a refused/stale-grant upgrade in CONNECTING
        // without an error or close event. Bound that platform behavior so
        // the shared manager can fence the socket, refresh the grant, and
        // re-subscribe promptly after a server restart.
        heartbeatIntervalMs: 1_000,
        freshnessBudgetMs: 5_000,
        reconnectBaseDelayMs: 250,
        reconnectMaxDelayMs: 2_000,
      },
      connectionId: `partitime_native_${Platform.OS}_${record.name}_${sequence += 1}`,
      onUpdate(next) {
        if (!active || record.disposed || generation !== record.generation) return;
        deliverAuthoritative(record, next, 'live');
      },
      onConnectionChange(connection, detail = {}) {
        if (!active || record.disposed || generation !== record.generation) return;
        record.connection = connection;
        record.observer(
          record.rows,
          connection,
          detail.error ? { kind: 'error', error: detail.error } : { kind: 'connection' },
        );
        if (detail.error) {
          void report('connection-error', {
            connection,
            code: detail.error.code ?? detail.error.diagnostic?.code ?? null,
            message: detail.error.message ?? String(detail.error),
          });
        }
      },
    });
    if (!active || record.disposed || generation !== record.generation) {
      handle.dispose();
      return;
    }
    record.handle = handle;
    deliverAuthoritative(record, handle.rows, handle.connection);
  };

  const provider = {
    backend: 'snapback-native-online',
    externalStoreProtocol: 'snapback.external-store.v1',
    async subscribe(name, args, userId, observer) {
      const record = {
        name,
        args,
        userId,
        observer,
        rows: [],
        connection: active ? 'connecting' : 'stale',
        handle: null,
        generation: 0,
        attempt: 0,
        disposed: false,
      };
      subscriptions.add(record);
      await startRecord(record);
      return {
        protocol: 'snapback.external-store.v1',
        rows: record.rows,
        connection: record.connection,
        dispose() {
          if (record.disposed) return;
          record.disposed = true;
          record.generation += 1;
          subscriptions.delete(record);
          record.handle?.dispose();
          record.handle = null;
        },
      };
    },
    async mutate(name, args, userId) {
      const result = await client.mutate(api[name], { args, userId });
      return result.result;
    },
    async quiesce() {
      if (!active) return provider.inspection();
      active = false;
      for (const record of subscriptions) {
        record.generation += 1;
        record.handle?.dispose();
        record.handle = null;
        record.connection = 'stale';
        record.observer(record.rows, 'stale', { kind: 'connection' });
      }
      return provider.inspection();
    },
    async resume() {
      if (active) return provider.inspection();
      active = true;
      await Promise.all([...subscriptions].map(startRecord));
      return provider.inspection();
    },
    inspection() {
      return {
        active,
        subscriptions: subscriptions.size,
        activeHandles: [...subscriptions].filter((record) => record.handle !== null).length,
        deliverySequence,
      };
    },
  };
  return provider;
}

function NativeSurface({ provider }) {
  const [userId, setUserId] = useState('user_eve');
  const optimisticMutationStarted = useRef(false);
  const authorityMutationStarted = useRef(false);
  const optimisticTitle = useRef(null);
  const authorityTitle = useRef(null);
  const reported = useRef(new Set());
  const query = useSnapbackQuery({ provider, name: 'listEvents', args: {}, userId, authority: userId });
  const emitOnce = (key, event, details) => {
    if (reported.current.has(key)) return;
    reported.current.add(key);
    void report(event, details);
  };

  useEffect(() => {
    void report('connection', {
      value: query.connection,
      status: query.status,
      rowCount: query.rows.length,
      rowIds: query.rows.map((row) => row._id),
      userId,
    });
    if (userId === 'user_eve' && query.status === 'ready' && query.connection === 'live' && query.rows.length > 0) {
      emitOnce('ready:user_eve', 'initial-authoritative', {
        rowCount: query.rows.length,
        userId,
      });
    }
  }, [query.connection, query.rows.length, query.status, userId]);

  useEffect(() => {
    const optimisticId = `native-${Platform.OS}-optimistic`;
    const authorityId = `native-${Platform.OS}-authority`;
    if (query.mutation.id === optimisticId) {
      if (query.mutation.status === 'pending') {
        const rendered = query.rows.some((row) => row._id === 'optimistic-native-event');
        emitOnce('optimistic-pending', 'optimistic-pending', {
          mutationId: optimisticId,
          rendered,
          rowCount: query.rows.length,
        });
      }
      if (query.mutation.status === 'confirmed') {
        emitOnce('optimistic-confirmed', 'optimistic-confirmed', { mutationId: optimisticId });
      }
    }
    const authoritative = optimisticTitle.current
      && query.rows.find((row) => row.title === optimisticTitle.current && row.hostId === 'user_eve');
    if (
      userId === 'user_eve'
      && query.mutation.id === optimisticId
      && query.mutation.status === 'confirmed'
      && authoritative
      && !query.rows.some((row) => row._id === 'optimistic-native-event')
    ) {
      emitOnce('optimistic-authoritative', 'optimistic-authoritative', {
        mutationId: optimisticId,
        rowId: authoritative._id,
        hostId: authoritative.hostId,
      });
      setUserId('user_ada');
    }
    if (query.mutation.id === authorityId && query.mutation.status === 'pending') {
      emitOnce('auth-mutation-pending', 'auth-mutation-pending', { mutationId: authorityId });
    }
    if (query.mutation.id === authorityId && query.mutation.status === 'confirmed') {
      emitOnce('auth-mutation-confirmed', 'auth-mutation-confirmed', { mutationId: authorityId });
    }
    const successorRow = authorityTitle.current
      && query.rows.find((row) => row.title === authorityTitle.current && row.hostId === 'user_ada');
    if (
      userId === 'user_ada'
      && query.connection === 'live'
      && query.status === 'ready'
      && query.mutation.id === authorityId
      && query.mutation.status === 'confirmed'
      && successorRow
    ) {
      emitOnce('auth-resumed', 'auth-resumed', {
        rowCount: query.rows.length,
        rowId: successorRow._id,
        hostId: successorRow.hostId,
        userId,
      });
    }
  }, [query, userId]);

  useEffect(() => {
    if (optimisticMutationStarted.current || query.status !== 'ready' || query.rows.length === 0 || userId !== 'user_eve') return;
    optimisticMutationStarted.current = true;
    optimisticTitle.current = `Native Online ${Platform.OS} ${Date.now()}`;
    const optimisticRow = {
      _id: 'optimistic-native-event',
      title: optimisticTitle.current,
      location: 'Device',
      startsAt: Date.now(),
      hostName: 'Eve',
      accent: 'cobalt',
      emoji: '📱',
    };
    void query.mutate('createEvent', {
      title: optimisticTitle.current,
      emoji: '📱',
      description: 'React Expo Online carrier proof',
      location: 'Device',
      startsAt: Date.now() + 60_000,
      hostName: 'Eve',
      accent: 'cobalt',
    }, {
      id: `native-${Platform.OS}-optimistic`,
      optimisticRows: (rows) => [...rows, optimisticRow],
      isAuthoritative: (rows) => rows.some(
        (row) => row.title === optimisticTitle.current && row.hostId === 'user_eve',
      ),
    }).catch((error) => void report('optimistic-rejected', { message: String(error) }));
  }, [query, userId]);

  useEffect(() => {
    if (authorityMutationStarted.current || query.status !== 'ready' || query.connection !== 'live' || userId !== 'user_ada') return;
    authorityMutationStarted.current = true;
    authorityTitle.current = `Native Authority ${Platform.OS} ${Date.now()}`;
    void query.mutate('createEvent', {
      title: authorityTitle.current,
      emoji: '🔐',
      description: 'Successor authority carrier proof',
      location: 'Device',
      startsAt: Date.now() + 120_000,
      hostName: 'Ada',
      accent: 'tangerine',
    }, {
      id: `native-${Platform.OS}-authority`,
    }).catch((error) => void report('auth-mutation-rejected', { message: String(error) }));
  }, [query, userId]);

  return (
    <SafeAreaView style={styles.safe} testID="native-surface">
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.eyebrow}>REACT EXPO · SNAPBACK · ONLINE</Text>
        <Text style={styles.title}>Partitime Native</Text>
        <View style={styles.status}>
          <Text testID="connection">{query.connection}</Text>
          <Text testID="query-status">{query.status}</Text>
          <Text testID="authority">{userId}</Text>
          <Text testID="mutation-status">{query.mutation.status}</Text>
        </View>
        {query.rows.map((event) => (
          <View key={event._id} style={styles.card} testID={`event-${event._id}`}>
            <Text style={styles.emoji}>{event.emoji}</Text>
            <View><Text style={styles.cardTitle}>{event.title}</Text><Text>{event.location}</Text></View>
          </View>
        ))}
        <Pressable style={styles.button} onPress={() => setUserId((value) => value === 'user_eve' ? 'user_ada' : 'user_eve')} testID="rotate-authority">
          <Text style={styles.buttonText}>Rotate authority</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [error, setError] = useState(null);
  const providerRef = useRef(null);
  const launchId = carrierLaunchId;
  useEffect(() => {
    void report('device-launch', { launchId, osVersion: String(Platform.Version) });
    let backgrounded = false;
    let lifecycle = Promise.resolve();
    const subscription = AppState.addEventListener('change', (state) => {
      void report('app-state', { state, launchId });
      if ((state === 'inactive' || state === 'background') && !backgrounded) {
        backgrounded = true;
        lifecycle = lifecycle.then(async () => {
          const inspection = await providerRef.current?.quiesce();
          await report('provider-quiesced', { state, ...inspection });
        });
      } else if (state === 'active' && backgrounded) {
        backgrounded = false;
        lifecycle = lifecycle.then(async () => {
          const inspection = await providerRef.current?.resume();
          await report('provider-resumed', { state, ...inspection });
        });
      }
    });
    createProvider().then((next) => {
      providerRef.current = next;
      setProvider(next);
      void report('provider-ready', { launchId });
    }, (reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      void report('provider-error', { launchId, message: String(reason) });
    });
    return () => {
      subscription.remove();
      void providerRef.current?.quiesce();
      providerRef.current = null;
    };
  }, [launchId]);
  if (error) return <SafeAreaView style={styles.safe}><Text testID="boot-error">{error}</Text></SafeAreaView>;
  if (!provider) return <SafeAreaView style={styles.safe}><Text testID="boot-pending">Connecting…</Text></SafeAreaView>;
  return <NativeSurface provider={provider} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f0e8' },
  body: { padding: 24, gap: 16 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: '#815c42' },
  title: { fontSize: 42, fontWeight: '900', color: '#1e1b18' },
  status: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, backgroundColor: '#fff', borderRadius: 16 },
  emoji: { fontSize: 32 },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  button: { backgroundColor: '#1e1b18', borderRadius: 999, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '800' },
});
