// First import observes the application's embedded public configuration.
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { View, Text, Image, NativeModules } from 'react-native';
import { Asset } from 'expo-asset';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Font from 'expo-font';
import * as SecureStore from 'expo-secure-store';
import { createClient, mintId } from 'snapback4/client';
import { signup } from 'snapback4/auth';
import { api } from '../snapback/generated/api';
import { launch, observation, releaseSmoke, native } from './np-gate';
import { app, url } from './client';
import { router } from 'expo-router';
export const marker = 'NP B';
const initial = { name: Constants.expoConfig?.name, scheme: Constants.expoConfig?.scheme,
  bundleId: Constants.expoConfig?.ios?.bundleIdentifier, manifest: Constants.manifest,
  manifest2: Constants.manifest2, devLauncherManifest: NativeModules.EXDevLauncher?.manifestString ?? null, updates: requireOptionalNativeModule('ExpoUpdates'), scriptURL: NativeModules.SourceCode?.getConstants?.().scriptURL ?? NativeModules.SourceCode?.scriptURL, dev: __DEV__, hermes: !!(globalThis as any).HermesInternal };
const image = require('../assets/np/probe.png');
const media = require('../assets/np/probe.wav');
const font = require('../assets/np/probe.ttf');
const pause = (ms = 100) => new Promise(r => setTimeout(r, ms));
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
async function until<T>(read: () => Promise<T | null>): Promise<T> {
  for (let n = 0; n < 900; n++) { const value = await read(); if (value !== null) return value; await pause(); }
  throw Error('NP fixture/probe timeout');
}
let began = false;
export function NPProbe() {
  const [status, setStatus] = useState('opening'), [loaded, setLoaded] = useState(false), [done, setDone] = useState(false);
  useEffect(() => {
    if (!launch?.smoke || began) return; began = true; observation({ phase: 'effect-started', initial });
    void (async () => {
      assert(!initial.dev && initial.hermes && initial.name === 'Clique' && initial.scheme === 'snapback4chat' && initial.bundleId === 'app.clique.astra', 'initial embedded config differs');
      assert(!initial.devLauncherManifest && !initial.manifest2 && !initial.updates, 'unexpected launcher/updates manifest');
      assert(initial.scriptURL?.includes('.app/main.jsbundle') && initial.scriptURL?.startsWith('file:'), 'runtime did not launch the embedded bundle');
      setStatus('loading font'); observation({ phase: 'font-start' }); await Font.loadAsync({ NPFont: font }); observation({ phase: 'font-ready' });
      setStatus('loading local media'); const asset = Asset.fromModule(media); observation({ phase: 'media-start', uri: asset.uri }); await asset.downloadAsync(); observation({ phase: 'media-ready' });
      assert(asset.localUri?.startsWith('file:'), 'local media did not resolve from embedded assets');
      setStatus('restoring session'); await app.ready; observation({ phase: 'app-ready', state: app.auth.state });
      const key = 'np.fixture.conversation';
      let conversation = await SecureStore.getItemAsync(key);
      if (launch.segment === 'prime' && !conversation) {
        // Ordinary password authentication; no credentials are logged or retained in evidence.
        const nonce = mintId(), password = mintId() + mintId();
        const signed = await app.auth.signup(`np-${nonce}@example.invalid`, password);
        assert(signed.ok, 'normal test signup failed');
        const bob = await signup(url, `np-bob-${nonce}@example.invalid`, mintId() + mintId());
        assert(bob.ok, 'normal second test account signup failed');
        const other = createClient({ url, session: bob.session });
        const write = async (client: any, op: any, args: any) => {
          const settled: any[] = []; const off = client.onWrite((w: any) => settled.push(w));
          try {
            const r = await client.mutate(op, args); assert(r.state !== 'failed', `${op.name} refused: ${r.why?.code}`);
            const final = r.state === 'sent' ? r : await until(async () => settled.find(w => w.id === r.id) ?? null);
            assert(final.state === 'sent', `${op.name} did not settle successfully`); return final;
          } finally { off(); }
        };
        await write(other, api.saveProfile, { displayName: 'NP Bob', handle: 'npb' + nonce.slice(-10).toLowerCase(), bio: '', location: '', link: null });
        await write(app.client, api.saveProfile, { displayName: 'NP Alice', handle: 'npa' + nonce.slice(-10).toLowerCase(), bio: '', location: '', link: null });
        conversation = mintId();
        await write(app.client, api.chat.createGroup, { conversationId: conversation, title: 'Native proof history', description: 'Normal test fixture', other: bob.session.principal });
        for (let n = 1; n <= 8; n++) await write(app.client, api.chat.send, { messageId: mintId(), conversation, text: `Retained native history ${n}`, quote: null });
        await other.close();
        await SecureStore.setItemAsync(key, conversation);
      }
      assert(conversation, 'missing primed conversation');
      const history = await until(async () => {
        const r = await app.client.query(api.chat.history, { conversation });
        return 'data' in r && r.data.length === 8 ? r : null;
      });
      assert(app.client.link() === (launch.segment === 'offline' ? 'offline' : 'online'), 'unexpected client link');
      router.replace('/conversation/id/' + conversation);
      setStatus(`${launch.segment}: ${history.data.length} held messages`);
      observation({ marker, initial, media: { local: true, type: asset.type, hash: asset.hash }, font: Font.isLoaded('NPFont'), conversation, historyCount: history.data.length, fresh: history.fresh, origin: url });
      setDone(true);
    })().catch(error => { setStatus(String(error)); native.witnessAppend(JSON.stringify({ error: String(error), witness: { at: new Date().toISOString(), step: 'np:failed' } }) + '\n'); });
  }, []);
  useEffect(() => {
    if (done && loaded) void (async () => { await pause(900); observation({ marker, imageLoaded: true }); releaseSmoke(); })();
  }, [done, loaded]);
  if (!launch?.smoke) return null;
  return <View style={{ paddingTop: 55, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: '#eaf4ff' }}>
    <Text style={{ fontSize: 20, fontFamily: done ? 'NPFont' : undefined }}>{marker} · {status}</Text>
    <Text>{launch.proof?.proofKind} {launch.proof?.sha256?.slice(0, 12)}</Text>
    <Image source={image} style={{ width: 120, height: 32 }} onLoad={() => setLoaded(true)} onError={() => { throw Error('NP bundled scaled image failed'); }} />
  </View>;
}
