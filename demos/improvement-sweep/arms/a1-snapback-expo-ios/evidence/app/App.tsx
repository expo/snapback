// LLP 0137 Track B — A1 offline field notebook on Expo iOS (snapback arm).
// The frozen neutral-expo shell with the notebook view wired to a live
// Snapback backend through the documented Expo path: the same
// @expo/snapback-client + generated refs + @expo/snapback-react hook as
// web (guide clients/react-expo.md — an Online surface; no local-first
// claim). The event view stays the frozen static shell.
//
// Offline honesty note (mirrors the web arm's a1-f5): @expo/snapback-react
// 0.1.7 exposes no freshness/retention/outbox projection, so the shell's
// freshness chip derives from connection status alone.
import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createExternalSessionClient, SnapbackClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  skip,
  useSnapbackConnection,
  useSnapbackQuery,
} from '@expo/snapback-react';
import api from './src/generated/api.mjs';
import schema from './src/generated/schema.manifest.json';
import functions from './src/generated/functions.manifest.json';
import capabilityManifest from './src/generated/capability.manifest.json';
import { fetchServerUrl } from './src/config';
import { harness, errorFacts } from './src/harness';
import { clearStoredSession, loadStoredSession, saveStoredSession } from './src/session';

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

type AnyClient = ReturnType<typeof createExternalSessionClient>;

type Session = {
  client: AnyClient;
  provider: ReturnType<typeof createSnapbackReactProvider>;
  userId: string;
  email: string;
  bearer: string;
};

type Phase = 'booting' | 'signed-out' | 'offline-locked' | 'ready';

async function establish(serverUrl: string, bearer: string): Promise<{ client: AnyClient; provider: Session['provider'] }> {
  const client = createExternalSessionClient(serverUrl, { bearerToken: bearer });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  return { client, provider: createSnapbackReactProvider(binding) };
}

export function App() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [bootNote, setBootNote] = useState<string>('starting');
  const sessionRef = useRef<Session | null>(null);
  const workspaceRef = useRef<string | null>(null);
  const serverUrlRef = useRef<string>('');
  const queueClientRef = useRef<InstanceType<typeof SnapbackClient> | null>(null);
  const phaseRef = useRef<Phase>('booting');
  phaseRef.current = phase;
  sessionRef.current = session;
  workspaceRef.current = workspaceId;

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (state) => {
      harness.post('app-state', { state });
    });

    const adopt = (next: { client: AnyClient; provider: Session['provider'] }, userId: string, email: string, bearer: string) => {
      const value: Session = { ...next, userId, email, bearer };
      sessionRef.current = value;
      setSession(value);
      setPhase('ready');
    };

    harness.on('ping', async () => ({
      at: Date.now(),
      phase: phaseRef.current,
      appState: AppState.currentState,
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
      serverUrl: serverUrlRef.current,
      userId: sessionRef.current?.userId ?? null,
      workspaceId: workspaceRef.current,
    }));

    harness.on('requestCode', async (args) => {
      const res = await fetch(`${serverUrlRef.current}/auth/request-code`, {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify({ email: args.email }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.diagnostic?.code ?? 'request-code failed');
      return { challengeId: body.challengeId };
    });

    harness.on('exchange', async (args) => {
      const res = await fetch(`${serverUrlRef.current}/auth/exchange`, {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify({ challengeId: args.challengeId, code: args.code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.diagnostic?.code ?? 'exchange failed');
      const next = await establish(serverUrlRef.current, body.token);
      adopt(next, body.session.userId, String(args.email ?? ''), body.token);
      await saveStoredSession({
        bearer: body.token,
        userId: body.session.userId,
        email: String(args.email ?? ''),
        workspaceId: workspaceRef.current,
      });
      return { userId: body.session.userId };
    });

    harness.on('setWorkspace', async (args) => {
      const id = String(args.workspaceId);
      workspaceRef.current = id;
      setWorkspaceId(id);
      const current = sessionRef.current;
      if (current) {
        await saveStoredSession({
          bearer: current.bearer,
          userId: current.userId,
          email: current.email,
          workspaceId: id,
        });
      }
      return true;
    });

    harness.on('mutate', async (args) => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const ref = (api as unknown as Record<string, unknown>)[String(args.name)];
      if (!ref) throw new Error(`unknown api ref ${String(args.name)}`);
      return await (current.client as unknown as {
        mutate: (ref: unknown, options: { args: unknown }) => Promise<unknown>;
      }).mutate(ref, { args: args.args ?? {} });
    });

    harness.on('queryState', async () => harness.state);

    harness.on('clientInfo', async () => {
      const current = sessionRef.current;
      const client = current?.client as unknown as {
        rqsStoreInfo?: unknown;
        outboxDiagnostics?: unknown;
      } | undefined;
      return {
        rqsStoreInfo: client?.rqsStoreInfo ?? null,
        outboxDiagnostics: client?.outboxDiagnostics ?? null,
      };
    });

    harness.on('queueClientStart', async () => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const client = new SnapbackClient(serverUrlRef.current, {
        bearerToken: current.bearer,
        authClientProtocol: 1,
        authInvalidationProtocol: 1,
        authorityDescriptorProtocol: 1,
        authorizedLeaseProtocol: 1,
        clientStoreId: 'a1-expo-alice-queue',
        offlineQueue: true,
      } as never);
      queueClientRef.current = client;
      return { rqsStoreInfo: (client as unknown as { rqsStoreInfo?: unknown }).rqsStoreInfo ?? null };
    });

    harness.on('queueClientMutate', async (args) => {
      const client = queueClientRef.current;
      if (!client) throw new Error('queue client not started');
      const ref = (api as unknown as Record<string, unknown>)[String(args.name)];
      if (!ref) throw new Error(`unknown api ref ${String(args.name)}`);
      return await (client as unknown as {
        mutate: (ref: unknown, options: { args: unknown }) => Promise<unknown>;
      }).mutate(ref, { args: args.args ?? {} });
    });

    harness.on('queueClientReplay', async () => {
      const client = queueClientRef.current as unknown as {
        replayQueuedMutations?: () => Promise<unknown>;
      } | null;
      if (!client?.replayQueuedMutations) throw new Error('replayQueuedMutations unavailable');
      return await client.replayQueuedMutations();
    });

    harness.on('queueClientInfo', async () => {
      const client = queueClientRef.current as unknown as {
        rqsStoreInfo?: unknown;
        outboxDiagnostics?: unknown;
      } | null;
      return {
        rqsStoreInfo: client?.rqsStoreInfo ?? null,
        outboxDiagnostics: client?.outboxDiagnostics ?? null,
      };
    });

    harness.on('queueClientDispose', async () => {
      const client = queueClientRef.current as unknown as { closeAuth?: () => Promise<void> } | null;
      queueClientRef.current = null;
      await client?.closeAuth?.();
      return true;
    });

    harness.on('replaceBearer', async (args) => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const token = args.token === null ? null : String(args.token);
      let lifecycleFailures: unknown = null;
      try {
        await (current.client as unknown as {
          replaceBearerToken: (token: string | null) => Promise<void>;
        }).replaceBearerToken(token);
      } catch (error) {
        // Observed on 0.1.7: rotating to a principal that loses access to
        // live protected queries rejects with AggregateError "external
        // bearer custody transition completed with lifecycle failures"
        // even though the custody transition itself completed (predecessor
        // blanked, successor subscribed/denied). Treat completion-with-
        // failures as completion and surface the facts (arm finding).
        const message = String((error as Error)?.message ?? error);
        if (!message.includes('completed with lifecycle failures')) throw error;
        lifecycleFailures = {
          message,
          errors: Array.isArray((error as AggregateError)?.errors)
            ? (error as AggregateError).errors.slice(0, 4).map((e) => errorFacts(e))
            : null,
        };
        harness.post('bearer-rotation-lifecycle-failures', { facts: lifecycleFailures });
      }
      if (token === null) {
        await clearStoredSession();
        harness.post('logout', { userId: current.userId });
      } else {
        const userId = String(args.userId ?? current.userId);
        const email = String(args.email ?? current.email);
        const value: Session = { ...current, bearer: token, userId, email };
        sessionRef.current = value;
        setSession(value);
        await saveStoredSession({ bearer: token, userId, email, workspaceId: workspaceRef.current });
        harness.post('bearer-rotated', { from: current.userId, to: userId });
      }
      return { completed: true, lifecycleFailures };
    });

    harness.on('headlessProbe', async (args) => {
      const bearer = typeof args.bearer === 'string' ? args.bearer : sessionRef.current?.bearer;
      if (!bearer) throw new Error('no bearer for probe');
      const client = new SnapbackClient(serverUrlRef.current, {
        bearerToken: bearer,
        authClientProtocol: 1,
        authInvalidationProtocol: 1,
        authorityDescriptorProtocol: 1,
        authorizedLeaseProtocol: 1,
        clientStoreId: String(args.storeId ?? 'a1-expo-probe'),
      } as never);
      const out: Record<string, unknown> = {
        rqsStoreInfo: (client as unknown as { rqsStoreInfo?: unknown }).rqsStoreInfo ?? null,
      };
      try {
        const ref = (api as unknown as Record<string, unknown>)[String(args.name)];
        if (!ref) throw new Error(`unknown api ref ${String(args.name)}`);
        const handle = await (client as unknown as {
          liveQuery: (ref: unknown, options: Record<string, unknown>) => Promise<{
            rows: ReadonlyArray<Record<string, unknown>>;
            version?: unknown;
            freshness?: unknown;
            connection?: unknown;
            retention?: unknown;
            dispose: () => Promise<void>;
          }>;
        }).liveQuery(ref, {
          ...(args.args === undefined ? {} : { args: args.args }),
          connectionId: String(args.connectionId ?? 'a1_expo_probe'),
          transport: 'stream',
        });
        out.result = {
          rows: handle.rows.length,
          version: handle.version ?? null,
          freshness: handle.freshness ?? null,
          connection: handle.connection ?? null,
          retention: handle.retention ?? null,
        };
        await handle.dispose();
      } catch (error) {
        out.error = errorFacts(error);
      }
      await (client as unknown as { closeAuth?: () => Promise<void> }).closeAuth?.();
      return out;
    });

    const boot = async () => {
      const serverUrl = await fetchServerUrl();
      serverUrlRef.current = serverUrl;
      const stored = await loadStoredSession();
      harness.post('boot', {
        serverUrl,
        hadStoredBearer: Boolean(stored?.bearer),
        platform: Platform.OS,
        platformVersion: String(Platform.Version),
        hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
      });
      if (!stored?.bearer) {
        setPhase('signed-out');
        setBootNote('signed out');
        return;
      }
      try {
        const next = await establish(serverUrl, stored.bearer);
        workspaceRef.current = stored.workspaceId ?? null;
        setWorkspaceId(stored.workspaceId ?? null);
        const value: Session = {
          ...next,
          userId: stored.userId,
          email: stored.email,
          bearer: stored.bearer,
        };
        sessionRef.current = value;
        setSession(value);
        setPhase('ready');
        setBootNote('session restored');
        harness.post('session-restored', { userId: stored.userId });
      } catch (error) {
        // Cold boot with the backend unreachable: the React binding cannot
        // prepare (deployment verification needs the server) and the
        // default rqs store on this carrier is the in-memory arm, so no
        // retained render is claimable. Report the exact facts.
        const facts = errorFacts(error);
        const probe: Record<string, unknown> = {};
        try {
          const probeClient = new SnapbackClient(serverUrl, {
            bearerToken: stored.bearer,
            authClientProtocol: 1,
            authInvalidationProtocol: 1,
            authorizedLeaseProtocol: 1,
            authorityDescriptorProtocol: 1,
            clientStoreId: 'a1-expo-alice',
          } as never);
          probe.rqsStoreInfo = (probeClient as unknown as { rqsStoreInfo?: unknown }).rqsStoreInfo ?? null;
          try {
            const sites = await (probeClient as unknown as {
              liveQuery: (ref: unknown, options: Record<string, unknown>) => Promise<{
                rows: ReadonlyArray<unknown>;
                freshness?: unknown;
                connection?: unknown;
                retention?: unknown;
                dispose: () => Promise<void>;
              }>;
            }).liveQuery((api as unknown as Record<string, unknown>).listSites, {
              connectionId: 'a1_expo_cold_sites',
              transport: 'stream',
            });
            probe.sites = {
              rows: sites.rows.length,
              freshness: sites.freshness ?? null,
              connection: sites.connection ?? null,
              retention: sites.retention ?? null,
            };
            await sites.dispose();
          } catch (probeError) {
            probe.sitesError = errorFacts(probeError);
          }
          await (probeClient as unknown as { closeAuth?: () => Promise<void> }).closeAuth?.();
        } catch (clientError) {
          probe.constructError = errorFacts(clientError);
        }
        setPhase('offline-locked');
        setBootNote(`${facts.code ?? facts.name ?? 'unreachable'}`);
        harness.post('cold-boot-offline', { restoreError: facts, headlessProbe: probe });
        // Auto-retry: a field notebook should recover the moment the
        // backend is reachable again, without user ceremony.
        let busy = false;
        const retry = setInterval(async () => {
          if (busy) return;
          busy = true;
          try {
            const next = await establish(serverUrl, stored.bearer);
            clearInterval(retry);
            workspaceRef.current = stored.workspaceId ?? null;
            setWorkspaceId(stored.workspaceId ?? null);
            const value: Session = {
              ...next,
              userId: stored.userId,
              email: stored.email,
              bearer: stored.bearer,
            };
            sessionRef.current = value;
            setSession(value);
            setPhase('ready');
            setBootNote('reconnected');
            harness.post('session-restored', { userId: stored.userId, after: 'offline-cold-boot' });
          } catch {
            // still unreachable
          } finally {
            busy = false;
          }
        }, 3000);
      }
    };

    void boot();
    void harness.run();
    return () => {
      appStateSub.remove();
      harness.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.frame} testID="app-root">
      <StatusBar style="dark" />
      {phase === 'ready' && session !== null ? (
        <SnapbackProvider provider={session.provider}>
          <NotebookScreen workspaceId={workspaceId} userId={session.userId} email={session.email} />
        </SnapbackProvider>
      ) : (
        <IdleScreen phase={phase} note={bootNote} />
      )}
      <View style={styles.tabRow}>
        <View style={[styles.tab, styles.tabActive]} testID="navigate-notebook">
          <Text style={styles.tabLabelActive}>notebook</Text>
        </View>
        <View style={styles.tab} testID="navigate-event">
          <Text style={styles.tabLabel}>event</Text>
        </View>
      </View>
    </View>
  );
}

function IdleScreen({ phase, note }: { phase: Phase; note: string }) {
  return (
    <View style={styles.screen} testID={`idle-${phase}`}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.eyebrow}>A1</Text>
          <Text style={styles.title}>Offline field notebook</Text>
        </View>
      </View>
      <Text style={styles.rowTitle} testID="idle-phase">
        {phase === 'booting' ? 'Starting…' : phase === 'signed-out' ? 'Signed out' : 'Backend unreachable'}
      </Text>
      <Text style={styles.rowMeta} testID="idle-note">{note}</Text>
      {phase === 'offline-locked' ? (
        <Text style={styles.rowMeta} testID="offline-explainer">
          This carrier is an Online surface: no local execution and no durable
          retained store, so the notebook cannot render until the backend is
          reachable.
        </Text>
      ) : null}
      <TextInput style={styles.composer} placeholder="you@example.test" testID="sign-in-email" />
    </View>
  );
}

function snapOf(query: {
  status: string;
  connection?: unknown;
  error?: { code?: string } | null;
  data?: ReadonlyArray<Record<string, unknown>>;
}): Record<string, unknown> {
  const q = query as Record<string, unknown>;
  return {
    status: query.status,
    connection: query.connection ?? null,
    error: (query.error as { code?: string } | null)?.code ?? null,
    freshness: q.freshness ?? null,
    retention: q.retention ?? null,
    rows: query.data?.map((row) => ({
      _id: row._id,
      title: row.title ?? row.name ?? null,
      state: row.state ?? null,
      position: row.position ?? null,
      revision: row.revision ?? null,
      assigneeName: row.assigneeName ?? null,
      dueAt: row.dueAt ?? null,
      notes: row.notes ?? null,
    })) ?? null,
  };
}

function NotebookScreen({
  workspaceId,
  userId,
  email,
}: {
  workspaceId: string | null;
  userId: string;
  email: string;
}) {
  const connection = useSnapbackConnection();
  const sites = useSnapbackQuery(api.listSites, {});
  const records = useSnapbackQuery(
    api.listRecords,
    workspaceId === null ? skip : ({ workspaceId } as never),
  );

  const lastReported = useRef<string>('');
  useEffect(() => {
    const snapshot = {
      connection: { status: connection.status },
      sites: snapOf(sites),
      records: snapOf(records),
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized !== lastReported.current) {
      lastReported.current = serialized;
      harness.report('notebook', snapshot);
    }
  });

  const live = connection.status === 'live';
  const fresh = live || connection.status === 'polling';
  const recordRows = records.status === 'ready' || records.status === 'refreshing' ? records.data : undefined;
  const siteRows = sites.status === 'ready' || sites.status === 'refreshing' ? sites.data : undefined;

  return (
    <View style={styles.screen} testID="notebook-screen">
      <View style={styles.topbar}>
        <View>
          <Text style={styles.eyebrow}>A1 · {email}</Text>
          <Text style={styles.title}>Offline field notebook</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={[styles.status, live ? null : styles.stale]} testID="connection-state">
            {String(connection.status)}
          </Text>
          {/* finding a1-f5 (cited): the React arm exposes no freshness fact;
              this chip is derived from connection status alone. */}
          <Text style={[styles.status, fresh ? null : styles.stale]} testID="freshness-state">
            {fresh ? 'Fresh' : 'Stale'}
          </Text>
        </View>
      </View>
      <ScrollView>
        {(recordRows ?? []).map((record, index) => (
          <View key={String(record._id)} style={styles.row} testID={`notebook-record-${index}`}>
            <View style={[styles.check, record.state === 'done' && styles.checked]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{String(record.title)}</Text>
              <Text style={styles.rowMeta}>
                {String(record.assigneeName)} · due {new Date(Number(record.dueAt)).toISOString().slice(0, 10)} · rev {String(record.revision)}
                {record.assigneeId === userId ? ' · mine' : ''}
              </Text>
            </View>
          </View>
        ))}
        <Text style={styles.footNote} testID="records-summary">
          {records.status === 'skipped'
            ? 'No workspace selected'
            : `records: ${records.status} (${recordRows?.length ?? 0})`}
        </Text>
        <Text style={styles.footNote} testID="sites-summary">
          sites: {sites.status} ({siteRows?.length ?? 0})
        </Text>
      </ScrollView>
      <Text style={styles.footNote} testID="notebook-queue-state">
        {live ? 'All changes settled' : 'Backend unreachable — new changes will fail'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#eceee8', paddingTop: 64 },
  screen: { flex: 1, paddingHorizontal: 20 },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  eyebrow: {
    color: '#69736e',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  statusRow: { flexDirection: 'row', gap: 8 },
  status: {
    backgroundColor: '#dff6df',
    color: '#24622e',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    overflow: 'hidden',
  },
  stale: { backgroundColor: '#f6eddf', color: '#7a5a24' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e8e1',
  },
  rowBody: { flex: 1 },
  rowTitle: { fontWeight: '700' },
  rowMeta: { color: '#727b76', fontSize: 13, marginTop: 3 },
  check: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#aab3ad',
    borderRadius: 6,
    backgroundColor: 'white',
  },
  checked: { backgroundColor: '#8fcf58' },
  footNote: { color: '#63716a', fontSize: 13, marginVertical: 12 },
  composer: {
    borderWidth: 1,
    borderColor: '#cbd2c8',
    backgroundColor: 'white',
    borderRadius: 11,
    padding: 13,
    marginTop: 8,
  },
  tabRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#dfe3db',
    backgroundColor: '#f9faf6',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  tabActive: { backgroundColor: '#e9ede5' },
  tabLabel: { color: '#69736e', textTransform: 'capitalize' },
  tabLabelActive: { color: '#17231f', fontWeight: '700', textTransform: 'capitalize' },
});
