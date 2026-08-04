// B1 on-device witness — React Native durable RQS store arm.
//
// The app registers its expo-file-system module ONCE at the root (the
// documented one-line opt-in) and every subsequently constructed client
// resolves the durable file arm through the default ladder on this carrier.
// The director drives: online subscribe to the retainable public query
// (listSites) with an explicit flushResumeState, protected subscribe
// (listRecords) that must never persist, then — after the host kills the
// server and relaunches the app — an offline cold-boot probe that must
// present the RETAINED rows with honest freshness/connection facts.
import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  SnapbackClient,
  createExternalSessionClient,
  registerExpoFileSystemRqsFiles,
  resolveDefaultRqsStore,
} from '@expo/snapback-client';
import { api } from './src/generated/api-notebook.mjs';
import { fetchServerUrl } from './src/config';
import { harness, errorFacts } from './src/harness';

// Root registration carries both the files arm and the CSPRNG required by
// format-v3 store metadata. It does not install a global WebCrypto polyfill.
registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

const KEY = 'b1.session.v1';

type LiveFacts = {
  rows: number;
  titles: ReadonlyArray<unknown>;
  freshness: unknown;
  connection: unknown;
  retention: unknown;
  rqsStoreInfo: unknown;
};

async function liveFacts(
  client: InstanceType<typeof SnapbackClient>,
  ref: unknown,
  args: Record<string, unknown> | undefined,
  connectionId: string,
  { flush = false, holdMs = 0 }: { flush?: boolean; holdMs?: number } = {},
): Promise<LiveFacts & { flushed?: unknown }> {
  const handle = await (client as unknown as {
    liveQuery: (ref: unknown, options: Record<string, unknown>) => Promise<{
      rows: ReadonlyArray<Record<string, unknown>>;
      freshness?: unknown;
      connection?: unknown;
      retention?: unknown;
      flushResumeState?: () => Promise<unknown>;
      dispose: () => Promise<void>;
    }>;
  }).liveQuery(ref, {
    ...(args === undefined ? {} : { args }),
    connectionId,
    transport: 'stream',
  });
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
  let flushed: unknown;
  if (flush && typeof handle.flushResumeState === 'function') {
    // The LLP 0091 step-5 lifecycle wiring: the embedding shell flushes
    // resume state on background/inactive; the probe flushes explicitly.
    flushed = await handle.flushResumeState();
  }
  const facts = {
    rows: handle.rows.length,
    titles: handle.rows.map((row) => row.name ?? row.title ?? null),
    freshness: handle.freshness ?? null,
    connection: handle.connection ?? null,
    retention: handle.retention ?? null,
    rqsResumeHeld: Boolean((handle as unknown as { rqsResume?: unknown }).rqsResume),
    rqsStoreInfo: (client as unknown as { rqsStoreInfo?: unknown }).rqsStoreInfo ?? null,
    flushed,
  };
  await handle.dispose();
  return facts;
}

export function App() {
  const [note, setNote] = useState('booting');
  const serverUrlRef = useRef('');
  const bearerRef = useRef<string | null>(null);
  // ONE long-lived session client for the whole app (the documented app
  // shape). The default-ladder store is single-writer per lock domain and
  // the client exposes no disposal that releases it, so sequential
  // short-lived clients in one process silently degrade to readers and
  // stop persisting — a sharp edge this probe surfaced (ticketed).
  const clientRef = useRef<ReturnType<typeof createExternalSessionClient> | null>(null);
  const sessionClient = () => {
    const bearer = bearerRef.current;
    if (!bearer) throw new Error('no bearer');
    clientRef.current ??= createExternalSessionClient(serverUrlRef.current, { bearerToken: bearer });
    return clientRef.current;
  };

  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (state) => {
      harness.post('app-state', { state });
    });

    harness.on('ping', async () => ({
      at: Date.now(),
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
      reactNativeNavigatorProduct: (globalThis as { navigator?: { product?: string } }).navigator?.product ?? null,
      serverUrl: serverUrlRef.current,
      hadStoredBearer: bearerRef.current !== null,
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
      bearerRef.current = body.token;
      await SecureStore.setItemAsync(KEY, String(body.token));
      return { userId: body.session.userId };
    });

    // Default-ladder resolution fact on the REAL carrier (no client needed).
    harness.on('ladderInfo', async () => {
      const resolved = resolveDefaultRqsStore({ baseUrl: serverUrlRef.current });
      const info = resolved.info;
      await (resolved.store as { close?: () => Promise<void> } | null)?.close?.();
      return { info };
    });

    harness.on('mutate', async (args) => {
      const client = sessionClient();
      return await (client as unknown as {
        mutate: (ref: unknown, options: { args: unknown }) => Promise<unknown>;
      }).mutate((api as unknown as Record<string, unknown>)[String(args.name)], { args: args.args ?? {} });
    });

    // Online (or offline cold-boot) live probe over the documented default
    // path: the client constructor resolves the registered durable store.
    harness.on('liveProbe', async (args) => {
      const client = sessionClient();
      const ref = (api as unknown as Record<string, unknown>)[String(args.name)];
      if (!ref) throw new Error(`unknown api ref ${String(args.name)}`);
      return await liveFacts(
        client,
        ref,
        args.args as Record<string, unknown> | undefined,
        String(args.connectionId ?? 'b1_probe'),
        { flush: args.flush === true, holdMs: Number(args.holdMs ?? 0) },
      );
    });

    // Store-file inspection for the sentinel witness: names + blob text read
    // through the same expo-file-system module the store writes with.
    harness.on('readStoreFiles', async () => {
      const dir = new FileSystem.Directory(FileSystem.Paths.document, 'snapback-rqs');
      if (!dir.exists) return { exists: false, names: [], blobs: {} };
      const names: string[] = [];
      const blobs: Record<string, string> = {};
      for (const entry of dir.list()) {
        const name = decodeURIComponent(entry.uri.replace(/\/+$/u, '').split('/').slice(-1)[0]);
        names.push(name);
        if (name.endsWith('.json')) {
          blobs[name] = new FileSystem.File(dir, name).textSync();
        }
      }
      return { exists: true, names, blobs };
    });

    harness.on('wipeStore', async () => {
      const resolved = resolveDefaultRqsStore({ baseUrl: serverUrlRef.current });
      if (!resolved.store) return { wiped: false };
      await (resolved.store as { whenLockSettled?: () => Promise<void> }).whenLockSettled?.();
      const wiped = await (resolved.store as { wipe: () => Promise<boolean> }).wipe();
      await (resolved.store as { close: () => Promise<void> }).close();
      return { wiped };
    });

    const boot = async () => {
      const serverUrl = await fetchServerUrl();
      serverUrlRef.current = serverUrl;
      const stored = await SecureStore.getItemAsync(KEY).catch(() => null);
      bearerRef.current = stored ?? null;
      setNote(stored ? 'bearer restored' : 'signed out');
      harness.post('boot', {
        serverUrl,
        hadStoredBearer: stored !== null,
        hermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
      });
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
      <View style={styles.screen}>
        <Text style={styles.eyebrow}>B1</Text>
        <Text style={styles.title}>Durable store probe</Text>
        <Text style={styles.rowMeta} testID="probe-note">{note}</Text>
      </View>
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
});
