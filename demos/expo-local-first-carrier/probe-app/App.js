import { useEffect, useState } from 'react';
import { Linking, Platform, SafeAreaView, ScrollView, Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { createExpoSqliteRqsResumeStore } from '@expo/snapback-client/rqs-store-sqlite';
import { resolveDefaultExpoSqliteTarget } from '@expo/snapback-expo';

const qualificationEnabled = process.env.EXPO_PUBLIC_SNAPBACK_SQLITE_QUALIFICATION_MODE === '1';
const invariantNames = Object.freeze([
  'old-or-new-whole-generation',
  'all-reported-host-watermarks-present',
  'no-partial-settlement',
  'one-writer',
  'predecessor-non-renderable-and-handle-key-rotated',
  'same-client-mutation-id-pending-or-settled',
  'server-execute-at-most-once',
  'settlement-republished-then-ack-removed',
]);
const never = new Promise(() => {});
let activeCut = null;
let storePromise = null;

const report = async (server, event) => fetch(`${server}/event`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(event),
});
const serverCommand = async (server, command, body) => {
  const response = await fetch(`${server}/${command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${command} server command failed: ${response.status}`);
  return response.json();
};
const digest = (value) => Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256,
  value,
);

const store = () => storePromise ??= createExpoSqliteRqsResumeStore({
  sqlite: SQLite,
  databaseName: 'qualification.sqlite',
  platformOperatingSystem: Platform.OS,
  randomBytes(length) { return Crypto.getRandomValues(new Uint8Array(length)); },
  qualificationMaxPageCount: 4096,
  async faultInjector(boundary) {
    if (activeCut === null || activeCut.boundary !== boundary) return;
    const cut = activeCut;
    activeCut = null;
    await report(cut.server, {
      type: 'cut-ready',
      phase: cut.phase,
      cycle: cut.cycle,
      boundary,
      insideTransaction: boundary.endsWith(':commit:before'),
    });
    await never;
  },
});

const entry = (key, generation) => ({
  rows: [{ key, generation }],
  meta: {},
  token: String(generation),
  bytes: 1,
  savedAt: generation,
  resumedAt: 0,
  inProgress: false,
});
const writeGeneration = (handle, cycle, generation, watermark = null) => handle.materializationTransaction(
  'readwrite',
  (view) => {
    const key = `generation:${cycle}`;
    view.entries.set(key, entry(key, generation));
    view.materializations.set(key, { generation });
    view.pageSets.set(key, { generation });
    view.memberships.set(key, { generation });
    if (watermark !== null) {
      const watermarkKey = `host-watermark:${cycle}:${watermark}`;
      view.entries.set(watermarkKey, entry(watermarkKey, generation));
    }
  },
);
const commitWatermark = async (handle, server, cycle, phase) => {
  const key = `host-watermark:${cycle}:${phase}`;
  await handle.commit(key, { rows: [{ cycle, phase }], meta: {}, token: phase });
  await report(server, { type: 'committed', cycle, phase, hostWatermark: phase });
};
const cutReady = async (server, cycle, phase, boundary) => {
  await report(server, { type: 'cut-ready', cycle, phase, boundary, insideTransaction: false });
  await never;
};

async function verify(server, cycle, expectedHandleKeyDigest) {
  const handle = await store();
  const facts = handle.qualificationFacts();
  const targetFacts = await resolveDefaultExpoSqliteTarget();
  const integrity = await handle.qualificationIntegrityCheck();
  const id = `device-${cycle}`;
  const predecessorKey = `predecessor-${cycle}`;
  const projected = await handle.materializationTransaction('readonly', (view) => {
    const key = `generation:${cycle}`;
    return {
      generationValues: [
        view.entries.get(key)?.rows?.[0]?.generation ?? null,
        view.materializations.get(key)?.generation ?? null,
        view.pageSets.get(key)?.generation ?? null,
        view.memberships.get(key)?.generation ?? null,
      ],
      recoveredHostWatermarks: [...view.entries.keys()]
        .filter((entryKey) => entryKey.startsWith(`host-watermark:${cycle}:`))
        .map((entryKey) => entryKey.slice(`host-watermark:${cycle}:`.length)),
    };
  });
  const recovered = (await handle.outboxRecords()).find((record) => record.id === id) ?? null;
  const partialSettlement = recovered?.status === 'pending'
    ? recovered.settlement != null || recovered.settledAt != null
    : recovered?.status === 'settled'
      ? recovered.settlement == null || !Number.isSafeInteger(recovered.settledAt)
      : true;
  let independentOwnerRefused = false;
  try {
    const second = await createExpoSqliteRqsResumeStore({
      sqlite: SQLite,
      databaseName: 'qualification.sqlite',
      platformOperatingSystem: Platform.OS,
      randomBytes(length) { return Crypto.getRandomValues(new Uint8Array(length)); },
    });
    await second.close();
  } catch (error) {
    independentOwnerRefused = error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE';
  }
  const execution = await serverCommand(server, 'execute', { clientMutationId: id });
  if (recovered?.status === 'pending') {
    await handle.outboxDurablyConsume(id, { result: execution.result }, 'qualification-user');
  }
  const republished = (await handle.outboxRecords()).find((record) => record.id === id) ?? null;
  await handle.outboxMarkAcknowledgementsReady([id]);
  const ackReadyObserved = (await handle.outboxPendingAcknowledgements('qualification-user')).includes(id);
  await serverCommand(server, 'ack', { clientMutationId: id });
  await handle.outboxConfirmAcknowledgements([id]);
  const removedAfterAckProof = !(await handle.outboxRecords()).some((record) => record.id === id)
    && !(await handle.outboxPendingAcknowledgements('qualification-user')).includes(id);
  const meta = await handle.readStoreMeta();
  const postBootRecord = {
    generation: { values: projected.generationValues },
    recoveredHostWatermarks: projected.recoveredHostWatermarks,
    writer: {
      recoveredOwner: (await handle.inspection()).writer,
      independentOwnerRefused,
    },
    predecessor: {
      renderable: (await handle.load(predecessorKey)) !== null,
      handleKeyRotated: (await digest(meta.handleKey)) !== expectedHandleKeyDigest,
    },
    expectedClientMutationId: id,
    mutation: {
      clientMutationId: recovered?.id ?? null,
      recoveredStatus: recovered?.status ?? null,
      partialSettlement,
    },
    server: { executionCount: execution.executionCount },
    settlement: {
      republished: republished?.status === 'settled'
        && republished?.settlement?.result?.clientMutationId === id,
      ackReadyObserved,
      removedAfterAckProof,
    },
    evaluatedInvariants: invariantNames,
  };
  await report(server, { type: 'verified', cycle, integrity, facts, targetFacts, postBootRecord });
}

async function handleCommand(url, append) {
  if (!qualificationEnabled) throw new Error('qualification build flag is absent');
  const input = new URL(url);
  const server = input.searchParams.get('server');
  const phase = input.searchParams.get('phase') ?? 'verify';
  const cycle = Number(input.searchParams.get('cycle') ?? 0);
  if (phase === 'verify') {
    await verify(server, cycle, input.searchParams.get('predecessorHandleKeyDigest'));
    append(`verified ${cycle}`);
    return;
  }

  const handle = await store();
  const facts = handle.qualificationFacts();
  const targetFacts = await resolveDefaultExpoSqliteTarget();
  const id = `device-${cycle}`;
  const predecessorKey = `predecessor-${cycle}`;
  await handle.commit(predecessorKey, {
    rows: [{ predecessor: true }], meta: {}, token: predecessorKey,
  });
  const predecessorMeta = await handle.readStoreMeta();
  await handle.wipeForAuthorityTransition();
  const successorMeta = await handle.readStoreMeta();
  await writeGeneration(handle, cycle, 1);
  await handle.outboxEnqueue({ id, function: 'qualificationMutation', args: { phase, cycle } });
  if (phase === 'consumed-before-ack' || phase === 'ack-proof-before-local-removal') {
    const execution = await serverCommand(server, 'execute', { clientMutationId: id });
    await handle.outboxDurablyConsume(id, { result: execution.result }, 'qualification-user');
  }

  const predecessorHandleKey = phase === 'authority-wipe-before-successor'
    ? successorMeta.handleKey
    : predecessorMeta.handleKey;
  await report(server, {
    type: 'armed',
    phase,
    cycle,
    facts,
    targetFacts,
    clientMutationId: id,
    predecessorHandleKeyDigest: await digest(predecessorHandleKey),
  });

  if (phase === 'pending-durable-before-delivery') {
    await cutReady(server, cycle, phase, phase);
  } else if (phase === 'server-result-before-local-settlement') {
    await serverCommand(server, 'execute', { clientMutationId: id });
    await cutReady(server, cycle, phase, 'server-result-held-local-settlement-uncommitted');
  } else if (phase === 'commit-loop') {
    activeCut = { server, cycle, phase, boundary: 'materialization:commit:before' };
    await writeGeneration(handle, cycle, 2, phase);
  } else if (phase === 'committed-before-callback') {
    await writeGeneration(handle, cycle, 2, phase);
    await report(server, { type: 'committed', cycle, phase, hostWatermark: phase });
    await cutReady(server, cycle, phase, 'commit-resolved-before-host-callback');
  } else if (phase === 'consumed-before-ack') {
    await commitWatermark(handle, server, cycle, phase);
    await cutReady(server, cycle, phase, 'settlement-consumed-before-ack-ready');
  } else if (phase === 'ack-proof-before-local-removal') {
    await handle.outboxMarkAcknowledgementsReady([id]);
    await commitWatermark(handle, server, cycle, phase);
    await cutReady(server, cycle, phase, phase);
  } else if (phase === 'authority-wipe-before-successor') {
    activeCut = { server, cycle, phase, boundary: 'authority-wipe:checkpoint-truncate:before' };
    await handle.wipeForAuthorityTransition();
  } else {
    throw new Error(`unknown qualification phase ${phase}`);
  }
}

export default function App() {
  const [lines, setLines] = useState([]);
  const append = (line) => setLines((current) => [...current.slice(-20), line]);
  useEffect(() => {
    const consume = (url) => void handleCommand(url, append).catch((error) => append(String(error)));
    void Linking.getInitialURL().then((url) => { if (url) consume(url); });
    const subscription = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => subscription.remove();
  }, []);
  return (
    <SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text selectable>Snapback Expo SQLite qualification probe</Text>
        <Text selectable>{qualificationEnabled ? 'QUALIFICATION MODE' : 'REFUSED: production mode'}</Text>
        {lines.map((line, index) => <Text selectable key={`${index}-${line}`}>{line}</Text>)}
      </ScrollView>
    </SafeAreaView>
  );
}
