// 0137 A1-Expo f7 evidence rerun — the ~2s reconnect-loop capture arm.
// A faithful trim of the A1 field-notebook app (same documented Expo path:
// createExternalSessionClient + prepareReactBinding + provider + hooks,
// same two on-device queries: retainable public listSites + protected
// listRecords), plus the ONE addition this rerun exists for: a witness tap
// on every live-stream manager's state events so the landed loss-detail
// instrumentation (closeCode / closeReason / errorPreceded / sinceOpenMs —
// issues/20260801-0137-a1expo-f7-rn-connection-cycles.md) reaches the host
// witness timeline. Runs against the repo packages at origin/main (client
// overlaid onto the installed 0.1.8 closure) and the same-sha dev server.
import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { createExternalSessionClient } from '@expo/snapback-client';
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

type Phase = 'booting' | 'signed-out' | 'ready';

// The f7 witness tap: enumerate the client's live-stream managers and
// forward every state transition WITH its detail payload to the host.
// The managers map is keyed by connectionId; a manager that closes for
// zero demand removes itself, so keep polling for newcomers.
const tappedManagers = new WeakSet<object>();
let lastTapHeartbeatAt = 0;
function tapStreamManagers(client: AnyClient) {
  const managers = (client as unknown as {
    __liveStreamManagers?: Map<string, {
      onState: (listener: (state: string, detail: unknown) => void) => () => void;
    }>;
  }).__liveStreamManagers;
  const now = Date.now();
  if (now - lastTapHeartbeatAt > 5000) {
    lastTapHeartbeatAt = now;
    harness.post('tap-heartbeat', { managerCount: managers ? managers.size : -1 });
  }
  if (!managers) return;
  for (const [connectionId, manager] of managers) {
    if (tappedManagers.has(manager)) continue;
    tappedManagers.add(manager);
    harness.post('stream-tap-attached', { connectionId });
    manager.onState((state, detail) => {
      harness.post('stream-state', {
        connectionId,
        state,
        detail: detail ?? null,
      });
    });
  }
}

async function establish(serverUrl: string, bearer: string): Promise<{ client: AnyClient; provider: Session['provider'] }> {
  const client = createExternalSessionClient(serverUrl, { bearerToken: bearer });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  setInterval(() => tapStreamManagers(client), 250);
  return { client, provider: createSnapbackReactProvider(binding) };
}

export function App() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const workspaceRef = useRef<string | null>(null);
  const serverUrlRef = useRef<string>('');
  const phaseRef = useRef<Phase>('booting');
  phaseRef.current = phase;
  sessionRef.current = session;
  workspaceRef.current = workspaceId;

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (state) => {
      harness.post('app-state', { state });
    });

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
      const value: Session = {
        ...next,
        userId: body.session.userId,
        email: String(args.email ?? ''),
        bearer: body.token,
      };
      sessionRef.current = value;
      // Adopt on the next tick so the director sees the exchange result
      // BEFORE the notebook mounts (run 2: a subscribe-retry thrash after
      // mount starved the response post and timed the driver out).
      setTimeout(() => {
        setSession(value);
        setPhase('ready');
      }, 250);
      void saveStoredSession({
        bearer: body.token,
        userId: body.session.userId,
        email: String(args.email ?? ''),
        workspaceId: workspaceRef.current,
      }).catch(() => {});
      return { userId: body.session.userId };
    });

    // Headless on-device probe: the same client subscribe machinery without
    // the React provider, capturing the raw error WITH ITS STACK — the
    // react hook serializes errors down to code+message.
    harness.on('headlessProbe', async (args) => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const out: Record<string, unknown> = {};
      try {
        const handle = await (current.client as unknown as {
          liveQuery: (ref: unknown, options: Record<string, unknown>) => Promise<{
            rows: ReadonlyArray<unknown>;
            freshness?: unknown;
            connection?: unknown;
            dispose: () => Promise<void>;
          }>;
        }).liveQuery((api as unknown as Record<string, unknown>)[String(args.name ?? 'listSites')], {
          ...(args.args === undefined ? {} : { args: args.args }),
          connectionId: String(args.connectionId ?? 'f7_headless'),
          transport: 'stream',
        });
        out.result = {
          rows: handle.rows.length,
          freshness: handle.freshness ?? null,
          connection: handle.connection ?? null,
        };
        if (args.holdMs) await new Promise((r) => setTimeout(r, Number(args.holdMs)));
        if (args.keep !== true) await handle.dispose();
      } catch (error) {
        const e = error as { message?: unknown; stack?: unknown; code?: unknown };
        out.error = {
          code: e.code ?? null,
          message: String(e.message ?? error),
          stack: String(e.stack ?? '').slice(0, 4000),
        };
      }
      return out;
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

    harness.on('logout', async () => {
      await clearStoredSession();
      return true;
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
      setPhase('signed-out');
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
          <NotebookScreen workspaceId={workspaceId} email={session.email} />
        </SnapbackProvider>
      ) : (
        <View style={styles.screen} testID={`idle-${phase}`}>
          <Text style={styles.eyebrow}>F7</Text>
          <Text style={styles.title}>Reconnect-loop evidence probe</Text>
          <Text style={styles.rowMeta} testID="idle-phase">{phase}</Text>
        </View>
      )}
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
    error: fullError(query.error),
    freshness: q.freshness ?? null,
    retention: q.retention ?? null,
    rows: query.data?.length ?? null,
  };
}

function fullError(error: unknown): Record<string, unknown> | null {
  if (!error) return null;
  const e = error as { code?: unknown; message?: unknown; diagnostic?: { message?: unknown; code?: unknown } };
  return {
    code: e.code ?? e.diagnostic?.code ?? null,
    message: String(e.diagnostic?.message ?? e.message ?? error),
  };
}

function NotebookScreen({ workspaceId, email }: { workspaceId: string | null; email: string }) {
  const connection = useSnapbackConnection();
  const sites = useSnapbackQuery(api.listSites, {});
  const records = useSnapbackQuery(
    api.listRecords,
    workspaceId === null ? skip : ({ workspaceId } as never),
  );

  // Rate-limited witness: the provider can thrash states at millisecond
  // cadence (observed in run 1), so cap posts at ~5/s and carry a count of
  // suppressed distinct snapshots between posts.
  const lastReported = useRef<string>('');
  const lastPostAt = useRef<number>(0);
  const suppressed = useRef<number>(0);
  useEffect(() => {
    const snapshot = {
      connection: { status: connection.status },
      sites: snapOf(sites),
      records: snapOf(records),
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastReported.current) return;
    const now = Date.now();
    if (now - lastPostAt.current < 200) {
      suppressed.current += 1;
      return;
    }
    lastReported.current = serialized;
    lastPostAt.current = now;
    harness.report('notebook', { ...snapshot, suppressedSinceLast: suppressed.current });
    suppressed.current = 0;
  });

  const live = connection.status === 'live';
  const siteRows = sites.status === 'ready' || sites.status === 'refreshing' ? sites.data : undefined;
  const recordRows = records.status === 'ready' || records.status === 'refreshing' ? records.data : undefined;

  return (
    <View style={styles.screen} testID="notebook-screen">
      <Text style={styles.eyebrow}>F7 · {email}</Text>
      <Text style={[styles.status, live ? null : styles.stale]} testID="connection-state">
        {String(connection.status)}
      </Text>
      <Text style={styles.rowMeta} testID="sites-summary">
        sites: {sites.status} ({siteRows?.length ?? 0})
      </Text>
      <Text style={styles.rowMeta} testID="records-summary">
        {records.status === 'skipped'
          ? 'No workspace selected'
          : `records: ${records.status} (${recordRows?.length ?? 0})`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#eceee8', paddingTop: 64 },
  screen: { flex: 1, paddingHorizontal: 20 },
  eyebrow: {
    color: '#69736e',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  rowMeta: { color: '#727b76', fontSize: 13, marginTop: 3 },
  status: {
    backgroundColor: '#dff6df',
    color: '#24622e',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    overflow: 'hidden',
    marginTop: 8,
  },
  stale: { backgroundColor: '#f6eddf', color: '#7a5a24' },
});
