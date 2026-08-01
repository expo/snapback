// LLP 0137 Track B — A4 event and invitation application on Expo iOS
// (snapback arm). The frozen neutral-expo shell with the EVENT view wired
// to a live Snapback backend through the documented Expo path: the same
// @expo/snapback-client + generated refs + @expo/snapback-react hook as
// web (guide clients/react-expo.md — an Online surface; no local-first
// claim). The notebook view stays the frozen static shell.
//
// Deep-link entry: the shell's sweepshell:// scheme carries the A4 invite
// deep link (sweepshell://invite?code=…); the app parses it exactly as the
// web arm's src/main.tsx parses ?invite= and redeems through the same
// authority-creating mutation, so the OS-level deep-link return leg is
// exercised for real on this carrier.
import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AppState,
  Image,
  Linking,
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
import { fromBase64, readAssetVariant, uploadAsset } from './src/upload';

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
  name: string;
};

type Phase = 'booting' | 'signed-out' | 'offline-locked' | 'ready';

async function establish(serverUrl: string, bearer: string): Promise<{ client: AnyClient; provider: Session['provider'] }> {
  const client = createExternalSessionClient(serverUrl, { bearerToken: bearer });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  return { client, provider: createSnapbackReactProvider(binding) };
}

const parseInviteUrl = (url: string): string | null => {
  // sweepshell://invite?code=INV-… — parsed manually (no WHATWG URL on Hermes).
  const match = /invite\?code=([A-Za-z0-9-]+)/.exec(url);
  return match ? match[1] : null;
};

export function App() {
  const [phase, setPhase] = useState<Phase>('booting');
  const [session, setSession] = useState<Session | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [bootNote, setBootNote] = useState<string>('starting');
  const sessionRef = useRef<Session | null>(null);
  const eventRef = useRef<string | null>(null);
  const serverUrlRef = useRef<string>('');
  const queueClientRef = useRef<InstanceType<typeof SnapbackClient> | null>(null);
  const phaseRef = useRef<Phase>('booting');
  phaseRef.current = phase;
  sessionRef.current = session;
  eventRef.current = eventId;

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (state) => {
      harness.post('app-state', { state });
    });

    const adopt = (next: { client: AnyClient; provider: Session['provider'] }, userId: string, email: string, bearer: string, name: string) => {
      const value: Session = { ...next, userId, email, bearer, name };
      sessionRef.current = value;
      setSession(value);
      setPhase('ready');
    };

    // ---- deep-link invite entry (A4 contract; OS-level return leg) ----
    const redeemFromUrl = async (url: string, origin: string) => {
      const code = parseInviteUrl(url);
      harness.post('deep-link-received', { url, code, origin });
      if (!code) return;
      const current = sessionRef.current;
      if (!current) {
        harness.post('deep-link-unredeemed', { reason: 'no session', code });
        return;
      }
      try {
        const settlement = await (current.client as unknown as {
          mutate: (ref: unknown, options: { args: unknown }) => Promise<Record<string, unknown>>;
        }).mutate((api as unknown as Record<string, unknown>).redeemInvite, {
          args: { code, name: current.name, enteredVia: 'deep-link' },
        });
        const result = settlement?.result as Record<string, unknown> | undefined;
        if (result?.eventId) {
          eventRef.current = String(result.eventId);
          setEventId(String(result.eventId));
          await saveStoredSession({
            bearer: current.bearer,
            userId: current.userId,
            email: current.email,
            eventId: String(result.eventId),
          });
        }
        harness.post('deep-link-redeemed', { code, settlement });
      } catch (error) {
        harness.post('deep-link-refused', { code, error: errorFacts(error) });
      }
    };
    const linkSub = Linking.addEventListener('url', ({ url }) => { void redeemFromUrl(url, 'event'); });

    harness.on('ping', async () => ({
      at: Date.now(),
      phase: phaseRef.current,
      appState: AppState.currentState,
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
      serverUrl: serverUrlRef.current,
      userId: sessionRef.current?.userId ?? null,
      eventId: eventRef.current,
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
      const name = String(args.name ?? 'Guest');
      adopt(next, body.session.userId, String(args.email ?? ''), body.token, name);
      await saveStoredSession({
        bearer: body.token,
        userId: body.session.userId,
        email: String(args.email ?? ''),
        eventId: eventRef.current,
      });
      return { userId: body.session.userId };
    });

    harness.on('setEvent', async (args) => {
      const id = String(args.eventId);
      eventRef.current = id;
      setEventId(id);
      const current = sessionRef.current;
      if (current) {
        await saveStoredSession({
          bearer: current.bearer,
          userId: current.userId,
          email: current.email,
          eventId: id,
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

    harness.on('query', async (args) => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const ref = (api as unknown as Record<string, unknown>)[String(args.name)];
      if (!ref) throw new Error(`unknown api ref ${String(args.name)}`);
      const out = await (current.client as unknown as {
        query: (ref: unknown, options: { args: unknown }) => Promise<{ rows: ReadonlyArray<unknown> }>;
      }).query(ref, { args: args.args ?? {} });
      return { rows: out.rows };
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

    // ---- on-device flyer upload/read (raw asset recipe; a1-f3 cited) ----
    harness.on('uploadFlyer', async (args) => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const bytes = fromBase64(String(args.base64));
      const intent = (api as unknown as Record<string, { name: string; intentPolicyHash?: string }>)[String(args.intent ?? 'flyerUpload')];
      if (!intent) throw new Error('unknown upload intent');
      return await uploadAsset(serverUrlRef.current, current.bearer, intent, String(args.filename ?? 'flyer.png'), bytes);
    });

    harness.on('readAsset', async (args) => {
      const token = args.anonymous === true ? null : sessionRef.current?.bearer ?? null;
      return await readAssetVariant(serverUrlRef.current, token, String(args.assetId), String(args.variant ?? 'primary'));
    });

    // ---- offline-queue opt-in re-verification (a1expo-f2 cited) ----
    harness.on('queueClientStart', async () => {
      const current = sessionRef.current;
      if (!current) throw new Error('no session');
      const client = new SnapbackClient(serverUrlRef.current, {
        bearerToken: current.bearer,
        authClientProtocol: 1,
        authInvalidationProtocol: 1,
        authorityDescriptorProtocol: 1,
        authorizedLeaseProtocol: 1,
        clientStoreId: 'a4-expo-queue',
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
        // Known on 0.1.7 (finding 0137-a1expo-f4, cited): rotating to a
        // principal that loses access to live protected queries rejects with
        // AggregateError "external bearer custody transition completed with
        // lifecycle failures" even though the custody transition completed.
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
        await saveStoredSession({ bearer: token, userId, email, eventId: eventRef.current });
        harness.post('bearer-rotated', { from: current.userId, to: userId });
      }
      return { completed: true, lifecycleFailures };
    });

    const boot = async () => {
      const serverUrl = await fetchServerUrl();
      serverUrlRef.current = serverUrl;
      const stored = await loadStoredSession();
      const initialUrl = await Linking.getInitialURL().catch(() => null);
      harness.post('boot', {
        serverUrl,
        hadStoredBearer: Boolean(stored?.bearer),
        initialUrl,
        platform: Platform.OS,
        platformVersion: String(Platform.Version),
        hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
      });
      if (!stored?.bearer) {
        setPhase('signed-out');
        setBootNote('signed out');
        if (initialUrl) void redeemFromUrl(initialUrl, 'initial');
        return;
      }
      try {
        const next = await establish(serverUrl, stored.bearer);
        eventRef.current = stored.eventId ?? null;
        setEventId(stored.eventId ?? null);
        const value: Session = {
          ...next,
          userId: stored.userId,
          email: stored.email,
          bearer: stored.bearer,
          name: 'Hana',
        };
        sessionRef.current = value;
        setSession(value);
        setPhase('ready');
        setBootNote('session restored');
        harness.post('session-restored', { userId: stored.userId });
        if (initialUrl) void redeemFromUrl(initialUrl, 'initial');
      } catch (error) {
        // Cold boot with the backend unreachable: the React binding cannot
        // prepare (deployment verification needs the server) and the default
        // rqs store on this carrier is the in-memory arm (0137-a1expo-f3,
        // cited), so no retained render is claimable. Report the exact facts.
        const facts = errorFacts(error);
        const probe: Record<string, unknown> = {};
        try {
          const probeClient = new SnapbackClient(serverUrl, {
            bearerToken: stored.bearer,
            authClientProtocol: 1,
            authInvalidationProtocol: 1,
            authorizedLeaseProtocol: 1,
            authorityDescriptorProtocol: 1,
            clientStoreId: 'a4-expo-hana',
          } as never);
          probe.rqsStoreInfo = (probeClient as unknown as { rqsStoreInfo?: unknown }).rqsStoreInfo ?? null;
          try {
            const preview = await (probeClient as unknown as {
              liveQuery: (ref: unknown, options: Record<string, unknown>) => Promise<{
                rows: ReadonlyArray<unknown>;
                freshness?: unknown;
                connection?: unknown;
                retention?: unknown;
                dispose: () => Promise<void>;
              }>;
            }).liveQuery((api as unknown as Record<string, unknown>).eventPreview, {
              args: { slug: 'lantern-supper' },
              connectionId: 'a4_expo_cold_preview',
              transport: 'stream',
            });
            probe.preview = {
              rows: preview.rows.length,
              freshness: preview.freshness ?? null,
              connection: preview.connection ?? null,
              retention: preview.retention ?? null,
            };
            await preview.dispose();
          } catch (probeError) {
            probe.previewError = errorFacts(probeError);
          }
          await (probeClient as unknown as { closeAuth?: () => Promise<void> }).closeAuth?.();
        } catch (clientError) {
          probe.constructError = errorFacts(clientError);
        }
        setPhase('offline-locked');
        setBootNote(`${facts.code ?? facts.name ?? 'unreachable'}`);
        harness.post('cold-boot-offline', { restoreError: facts, headlessProbe: probe });
        // Auto-retry: an event app should recover the moment the backend is
        // reachable again, without user ceremony.
        let busy = false;
        const retry = setInterval(async () => {
          if (busy) return;
          busy = true;
          try {
            const next = await establish(serverUrl, stored.bearer);
            clearInterval(retry);
            eventRef.current = stored.eventId ?? null;
            setEventId(stored.eventId ?? null);
            const value: Session = {
              ...next,
              userId: stored.userId,
              email: stored.email,
              bearer: stored.bearer,
              name: 'Hana',
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
      linkSub.remove();
      harness.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.frame} testID="app-root">
      <StatusBar style="dark" />
      {phase === 'ready' && session !== null ? (
        <SnapbackProvider provider={session.provider}>
          <EventScreen
            eventId={eventId}
            userId={session.userId}
            email={session.email}
            name={session.name}
            bearer={session.bearer}
            serverUrl={serverUrlRef.current}
            onRsvp={async (status) => {
              const current = sessionRef.current;
              const id = eventRef.current;
              if (!current || !id) return;
              try {
                const settlement = await (current.client as unknown as {
                  mutate: (ref: unknown, options: { args: unknown }) => Promise<unknown>;
                }).mutate((api as unknown as Record<string, unknown>).updateRsvp, {
                  args: { eventId: id, status, plusOnes: 0 },
                });
                harness.post('rsvp-settled', { status, settlement });
              } catch (error) {
                harness.post('rsvp-refused', { status, error: errorFacts(error) });
              }
            }}
          />
        </SnapbackProvider>
      ) : (
        <IdleScreen phase={phase} note={bootNote} />
      )}
      <View style={styles.tabRow}>
        <View style={styles.tab} testID="navigate-notebook">
          <Text style={styles.tabLabel}>notebook</Text>
        </View>
        <View style={[styles.tab, styles.tabActive]} testID="navigate-event">
          <Text style={styles.tabLabelActive}>event</Text>
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
          <Text style={styles.eyebrow}>A4</Text>
          <Text style={styles.title}>Event and invitation</Text>
        </View>
      </View>
      <Text style={styles.rowTitle} testID="idle-phase">
        {phase === 'booting' ? 'Starting…' : phase === 'signed-out' ? 'Signed out' : 'Backend unreachable'}
      </Text>
      <Text style={styles.rowMeta} testID="idle-note">{note}</Text>
      {phase === 'offline-locked' ? (
        <Text style={styles.rowMeta} testID="offline-explainer">
          This carrier is an Online surface: no local execution and no durable
          retained store, so the event cannot render until the backend is
          reachable.
        </Text>
      ) : null}
      <TextInput style={styles.composer} placeholder="you@example.test" testID="sign-in-email" />
    </View>
  );
}

type QueryLike = {
  status: string;
  connection?: unknown;
  error?: { code?: string } | null;
  data?: ReadonlyArray<Record<string, unknown>>;
};

function snapRows(query: QueryLike, project: (row: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  return {
    status: query.status,
    error: (query.error as { code?: string } | null)?.code ?? null,
    rows: query.data?.map(project) ?? null,
  };
}

function EventScreen({
  eventId,
  userId,
  email,
  name,
  bearer,
  serverUrl,
  onRsvp,
}: {
  eventId: string | null;
  userId: string;
  email: string;
  name: string;
  bearer: string;
  serverUrl: string;
  onRsvp: (status: 'going' | 'maybe' | 'declined') => Promise<void>;
}) {
  const connection = useSnapbackConnection();
  const eventView = useSnapbackQuery(
    api.guestEventView,
    eventId === null ? skip : ({ eventId } as never),
  );
  const wall = useSnapbackQuery(
    api.wallFeed,
    eventId === null ? skip : ({ eventId } as never),
  );
  const guests = useSnapbackQuery(
    api.guestList,
    eventId === null ? skip : ({ eventId } as never),
  );

  const lastReported = useRef<string>('');
  useEffect(() => {
    const snapshot = {
      connection: { status: connection.status },
      eventView: snapRows(eventView as QueryLike, (row) => ({
        title: row.title ?? null,
        city: row.city ?? null,
        privateAddress: row.privateAddress ?? null,
        capacity: row.capacity ?? null,
        goingSeats: row.goingSeats ?? null,
        goingCount: row.goingCount ?? null,
        maybeCount: row.maybeCount ?? null,
        flyerAssetId: row.flyerAssetId ?? null,
      })),
      wall: snapRows(wall as QueryLike, (row) => ({
        seq: row.seq ?? null,
        authorName: row.authorName ?? null,
        authorId: row.authorId ?? null,
        body: row.body ?? null,
      })),
      guests: snapRows(guests as QueryLike, (row) => ({
        name: row.name ?? null,
        status: row.status ?? null,
        plusOnes: row.plusOnes ?? null,
        invitedByName: row.invitedByName ?? null,
        enteredVia: row.enteredVia ?? null,
      })),
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized !== lastReported.current) {
      lastReported.current = serialized;
      harness.report('event', snapshot);
    }
  });

  const live = connection.status === 'live';
  const fresh = live || connection.status === 'polling';
  const view = (eventView.status === 'ready' || eventView.status === 'refreshing' ? eventView.data?.[0] : undefined) as
    | Record<string, unknown>
    | undefined;
  const wallRows = (wall.status === 'ready' || wall.status === 'refreshing' ? wall.data : undefined) ?? [];
  const flyerAssetId = typeof view?.flyerAssetId === 'string' && view.flyerAssetId !== '' ? view.flyerAssetId : null;

  const rsvp = (status: 'going' | 'maybe' | 'declined') => {
    if (eventId === null) return;
    harness.post('rsvp-press', { status });
    void onRsvp(status);
  };

  return (
    <View style={styles.screen} testID="event-screen">
      <View style={styles.topbar}>
        <View>
          <Text style={styles.eyebrow}>A4 · {email}</Text>
          <Text style={styles.title}>Event and invitation</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={[styles.status, live ? null : styles.stale]} testID="connection-state">
            {String(connection.status)}
          </Text>
          {/* finding 0137-a1-f5 lineage (cited): the React arm exposes no
              freshness fact; this chip derives from connection status alone. */}
          <Text style={[styles.status, fresh ? null : styles.stale]} testID="freshness-state">
            {fresh ? 'Fresh' : 'Stale'}
          </Text>
        </View>
      </View>
      <ScrollView>
        {flyerAssetId !== null ? (
          <Image
            style={styles.eventArt}
            testID="event-flyer-image"
            source={{
              uri: `${serverUrl}/assets/records/${flyerAssetId}/bytes/card`,
              headers: {
                authorization: `Bearer ${bearer}`,
                'x-snapback-auth-client-protocol': '1',
              },
            }}
            onLoad={() => harness.post('flyer-image', { outcome: 'loaded', assetId: flyerAssetId })}
            onError={(e) => harness.post('flyer-image', { outcome: 'error', assetId: flyerAssetId, detail: String(e.nativeEvent?.error ?? 'error') })}
          />
        ) : (
          <View style={[styles.eventArt, styles.eventArtEmpty]} testID="event-art">
            <Text style={styles.eventArtLabel}>{view ? String(view.title ?? '').split(' ')[0].toUpperCase() : '—'}</Text>
          </View>
        )}
        <Text style={styles.rowTitle} testID="event-title">
          {view ? String(view.title) : eventId === null ? 'No invitation yet' : `event: ${eventView.status}`}
        </Text>
        <Text style={styles.rowMeta} testID="event-meta">
          {view
            ? `${new Date(Number(view.startsAt ?? 0)).toISOString().slice(0, 10)} · ${String(view.city)}`
            : eventId === null
              ? 'Open your invite link to join'
              : ''}
        </Text>
        {view ? (
          <Text style={styles.rowMeta} testID="event-address">
            {String(view.privateAddress)}
          </Text>
        ) : null}
        <View style={styles.rsvpRow} testID="event-rsvp-controls">
          {(['going', 'maybe', 'declined'] as const).map((status) => (
            <Pressable key={status} style={styles.rsvpButton} onPress={() => rsvp(status)} testID={`rsvp-${status}`}>
              <Text>{status === 'going' ? 'Going' : status === 'maybe' ? 'Maybe' : 'Can’t go'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.footNote} testID="event-guest-count">
          {view ? `${String(view.goingSeats)} / ${String(view.capacity)} attending` : '…'}
        </Text>
        {wallRows.map((post, index) => (
          <Text key={String(post.seq)} style={styles.rowMeta} testID={`event-wall-${index}`}>
            {String(post.authorName)} — {String(post.body)}
          </Text>
        ))}
        <Text style={styles.footNote} testID="event-summaries">
          wall: {wall.status} ({wallRows.length}) · guests: {guests.status} ({guests.data?.length ?? 0})
        </Text>
      </ScrollView>
      <TextInput
        style={styles.composer}
        placeholder="Post to the event wall…"
        testID="event-wall-composer"
      />
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
  rowTitle: { fontWeight: '700' },
  rowMeta: { color: '#727b76', fontSize: 13, marginTop: 3 },
  footNote: { color: '#63716a', fontSize: 13, marginVertical: 12 },
  eventArt: {
    height: 180,
    borderRadius: 16,
    backgroundColor: '#c965a8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  eventArtEmpty: { backgroundColor: '#c9a8b8' },
  eventArtLabel: {
    color: 'white',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -1.5,
  },
  rsvpRow: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  rsvpButton: {
    borderWidth: 1,
    borderColor: '#cbd2c8',
    backgroundColor: 'white',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
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
