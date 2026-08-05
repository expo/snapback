import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {
  SnapbackClient,
  registerExpoFileSystemRqsFiles,
} from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';
import api from '@warble/generated-api';
import schema from '../snapback/generated/schema.manifest.json';
import functions from '../snapback/generated/functions.manifest.json';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { WarbleScreen } from './src/warble-screen';
import { useWarbleTheme } from './src/theme';

// Native only. expo-file-system has no web implementation: constructing its
// Directory on web throws ("expo-file-system is not supported on web") and,
// because this runs at module scope, it takes the whole app down to a white
// screen rather than degrading. The persistence ladder already prefers browser
// IndexedDB over registered native files, so web loses nothing by skipping it.
if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4420';

type Provider = ReturnType<typeof createSnapbackReactProvider>;

type BootResult =
  | {
      phase: 'ready';
      client: SnapbackClient;
      provider: Provider;
    }
  | {
      phase: 'error';
      client: SnapbackClient | null;
      message: string;
      storeInfo: unknown;
    };

type BootState = { phase: 'booting' } | BootResult;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const theme = useWarbleTheme();
  const [boot, setBoot] = useState<BootState>({ phase: 'booting' });
  const bootTask = useRef<Promise<BootResult> | null>(null);
  const lifecycleGeneration = useRef(0);

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    let subscribed = true;

    bootTask.current ??= (async () => {
      let bootClient: SnapbackClient | null = null;
      try {
        const client = new SnapbackClient(origin);
        bootClient = client;
        const binding = await client.prepareReactBinding({
          generatedManifest: { schema, functions, capabilityManifest },
        });
        const provider = createSnapbackReactProvider(binding);
        return { phase: 'ready', client, provider };
      } catch (error) {
        return {
          phase: 'error',
          client: bootClient,
          message: errorMessage(error),
          storeInfo: bootClient?.rqsStoreInfo ?? null,
        };
      }
    })();

    void bootTask.current.then((result) => {
      if (subscribed) setBoot(result);
    });

    return () => {
      subscribed = false;
      // React development can replay an effect immediately. Deferring teardown
      // one microtask keeps that replay on the app's single client/store owner.
      queueMicrotask(() => {
        if (lifecycleGeneration.current !== generation) return;
        void bootTask.current?.then(async (result) => {
          if (result.phase === 'ready') await result.provider.dispose();
          await result.client?.closeAuth();
        });
      });
    };
  }, []);

  if (boot.phase === 'booting') {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <View style={[styles.splashMark, { backgroundColor: theme.accent }]}>
          <Text style={[styles.splashLetter, { color: theme.onAccent }]}>W</Text>
        </View>
        <Text style={[styles.splashTitle, { color: theme.text }]}>Warble</Text>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.splashNote, { color: theme.muted }]}>Opening your local timeline…</Text>
      </View>
    );
  }

  if (boot.phase === 'error') {
    return (
      <View style={[styles.centered, styles.errorScreen, { backgroundColor: theme.background }]}>
        <Text selectable style={[styles.errorEyebrow, { color: theme.danger }]}>COULDN’T START WARBLE</Text>
        <Text selectable style={[styles.errorMessage, { color: theme.text }]}>{boot.message}</Text>
        <View style={[styles.storeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text selectable style={[styles.storeLabel, { color: theme.muted }]}>On-device store</Text>
          <Text selectable style={[styles.storeValue, { color: theme.text }]}>
            {JSON.stringify(boot.storeInfo, null, 2)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <SnapbackProvider provider={boot.provider}>
      <WarbleScreen api={api} storeInfo={boot.client.rqsStoreInfo} />
    </SnapbackProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  splashMark: {
    alignItems: 'center',
    borderRadius: 24,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  splashLetter: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.5,
  },
  splashTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  splashNote: {
    fontSize: 14,
  },
  errorScreen: {
    alignItems: 'stretch',
  },
  errorEyebrow: {
    alignSelf: 'center',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  errorMessage: {
    alignSelf: 'center',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 25,
    maxWidth: 640,
    textAlign: 'center',
  },
  storeCard: {
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    maxWidth: 640,
    padding: 16,
    width: '100%',
  },
  storeLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  storeValue: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
