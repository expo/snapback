import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SnapbackExpoProvider,
  useSnapbackConnection,
  useSnapbackExpoBootState,
  useSnapbackMutation,
  useSnapbackQuery,
} from '@expo/snapback-expo';
import type { ExpoBootState } from '@expo/snapback-expo';

import { app } from './snapback/generated/app.mjs';
import api from './snapback/generated/api.mjs';

const mutationText = 'Mutation round-trip reached the live query';
const emptyQueryArgs = Object.freeze({});

function emit(event: string, details: Record<string, unknown> = {}) {
  console.log(`SNAPBACK_G1_EVENT ${JSON.stringify({ event, ...details })}`);
}

function BootFallback({ state }: { state: ExpoBootState }) {
  const diagnostic = 'diagnostic' in state ? state.diagnostic : null;
  return (
    <SafeAreaView style={styles.shell}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>LLP 0176 · G1 · iOS</Text>
        <Text style={styles.title}>Snapback supervised boot</Text>
        <Text testID="provider-status" style={styles.statusLine}>
          Provider: {state.status}
          {'stage' in state ? ` / ${state.stage}` : ''}
        </Text>
        {diagnostic ? (
          <Text testID="provider-diagnostic" style={styles.error}>
            {diagnostic.code}: {diagnostic.message}
            {'details' in diagnostic ? ` ${JSON.stringify(diagnostic.details)}` : ''}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function ReceiptScreen() {
  const boot = useSnapbackExpoBootState();
  const connection = useSnapbackConnection();
  const query = useSnapbackQuery(api.listReceiptNotes, emptyQueryArgs);
  const addReceiptNote = useSnapbackMutation(api.addReceiptNote);
  const mutationStarted = useRef(false);
  const bootLogged = useRef(false);
  const seedLogged = useRef(false);
  const passLogged = useRef(false);
  const [mutationState, setMutationState] = useState('waiting for live query');

  const notes = query.status === 'ready' || query.status === 'refreshing'
    ? query.data
    : [];
  const seeded = notes.some((note) => note.source === 'seed');
  const mutationObserved = notes.some((note) => (
    note.source === 'ios-simulator' && note.text === mutationText
  ));

  useEffect(() => {
    if (boot.status === 'ready' && !bootLogged.current) {
      bootLogged.current = true;
      emit('provider-ready', {
        routing: boot.binding.target.routing,
        authorityKind: boot.authority.kind,
        authMode: boot.authority.authMode,
        userId: boot.authority.userId,
      });
    }
  }, [boot]);

  useEffect(() => {
    if (seeded && !seedLogged.current) {
      seedLogged.current = true;
      emit('seed-live-query-observed', { rowCount: notes.length });
    }
  }, [notes.length, seeded]);

  useEffect(() => {
    if (!seeded || mutationObserved || mutationStarted.current) return;
    mutationStarted.current = true;
    setMutationState('mutation dispatched');
    emit('mutation-dispatched');
    void addReceiptNote({ text: mutationText, source: 'ios-simulator' })
      .then(() => {
        setMutationState('mutation settled; awaiting live echo');
        emit('mutation-settled');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setMutationState(`mutation failed: ${message}`);
        emit('mutation-failed', { message });
      });
  }, [addReceiptNote, mutationObserved, seeded]);

  useEffect(() => {
    if (mutationObserved && !passLogged.current) {
      passLogged.current = true;
      setMutationState('mutation observed through live query');
      emit('mutation-live-query-observed', {
        marker: 'G1_IOS_PASS',
        rowCount: notes.length,
      });
    }
  }, [mutationObserved, notes.length]);

  const fireAnother = () => {
    const text = `${mutationText} #${notes.length + 1}`;
    setMutationState('manual mutation dispatched');
    emit('manual-mutation-dispatched', { text });
    void addReceiptNote({ text, source: 'ios-simulator-manual' })
      .then(() => setMutationState('manual mutation settled'))
      .catch((error: unknown) => {
        setMutationState(`manual mutation failed: ${
          error instanceof Error ? error.message : String(error)
        }`);
      });
  };

  return (
    <SafeAreaView style={styles.shell}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>LLP 0176 · G1 · iOS simulator</Text>
          <Text style={styles.title}>No-URL Expo boot</Text>
          <Text style={styles.subtitle}>
            Binding and ordinary Sessions authority arrived through the
            loopback supervisor.
          </Text>
        </View>

        <View style={styles.card}>
          <Text testID="provider-status" style={styles.label}>Provider</Text>
          <Text style={styles.value}>{boot.status}</Text>
          <Text testID="provider-route" style={styles.detail}>
            {boot.status === 'ready' ? boot.binding.target.routing : 'pending'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Live query</Text>
          <Text testID="query-status" style={styles.value}>{query.status}</Text>
          <Text testID="connection-status" style={styles.detail}>
            connection: {connection.status}
          </Text>
          {notes.map((note) => (
            <View key={note._id} style={styles.note}>
              <Text style={styles.noteText}>{note.text}</Text>
              <Text style={styles.noteSource}>{note.source}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Ordinary mutation</Text>
          <Text testID="mutation-status" style={styles.value}>{mutationState}</Text>
          <Pressable
            accessibilityRole="button"
            testID="fire-mutation"
            style={styles.button}
            onPress={fireAnother}
          >
            <Text style={styles.buttonText}>Fire another mutation</Text>
          </Pressable>
        </View>

        <View style={[styles.verdict, mutationObserved ? styles.pass : styles.pending]}>
          <Text testID="g1-verdict" style={styles.verdictText}>
            {mutationObserved ? 'G1_IOS_PASS' : 'G1_IOS_PENDING'}
          </Text>
          <Text style={styles.verdictDetail}>
            {mutationObserved
              ? 'provider ready · seed live · mutation echoed live'
              : 'waiting for the supervised receipt chain'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SnapbackExpoProvider
      app={app}
      fallback={(state: ExpoBootState) => <BootFallback state={state} />}
    >
      <ReceiptScreen />
    </SnapbackExpoProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#f3efe7' },
  content: { padding: 22, gap: 14 },
  hero: {
    backgroundColor: '#12211b',
    borderRadius: 24,
    padding: 22,
    gap: 8,
  },
  eyebrow: {
    color: '#8de0bb',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: { color: '#ffffff', fontSize: 30, fontWeight: '800' },
  subtitle: { color: '#c7d8cf', fontSize: 15, lineHeight: 21 },
  statusLine: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  error: { color: '#ffb4a8', fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#d8d1c4',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 7,
  },
  label: {
    color: '#667168',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  value: { color: '#14231c', fontSize: 18, fontWeight: '700' },
  detail: { color: '#667168', fontSize: 13 },
  note: {
    backgroundColor: '#f3f7f4',
    borderLeftColor: '#2f8f66',
    borderLeftWidth: 4,
    borderRadius: 10,
    padding: 12,
  },
  noteText: { color: '#14231c', fontSize: 15, fontWeight: '600' },
  noteSource: { color: '#667168', fontSize: 11, marginTop: 3 },
  button: {
    alignItems: 'center',
    backgroundColor: '#285f49',
    borderRadius: 12,
    marginTop: 5,
    padding: 13,
  },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  verdict: { borderRadius: 18, padding: 18, gap: 4 },
  pass: { backgroundColor: '#c6f3d9', borderColor: '#2f8f66', borderWidth: 2 },
  pending: { backgroundColor: '#f6dfae', borderColor: '#bc8430', borderWidth: 2 },
  verdictText: { color: '#14231c', fontSize: 24, fontWeight: '900' },
  verdictDetail: { color: '#405247', fontSize: 13 },
});
