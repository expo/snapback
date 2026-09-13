import React, { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { randomUUID } from "expo-crypto";
import { defaultDatabaseDirectory, openDatabaseAsync } from "expo-sqlite";
import { createExpoClient, pages, type OperationSnapshot, type ResourceSnapshot } from "snapback3/expo";

declare const global: typeof globalThis & { HermesInternal?: unknown };

const CONTROL_URL = process.env.EXPO_PUBLIC_CONTROL_URL!;
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL!;
const PACKAGE_SHA256 = process.env.EXPO_PUBLIC_PACKAGE_SHA256!;
const PACKAGE_SOURCE_SHA256 = process.env.EXPO_PUBLIC_PACKAGE_SOURCE_SHA256!;
const RUN_ID = process.env.EXPO_PUBLIC_RUN_ID!;
const ROOM = "native-room";
const EXPECTED_SEEDS = ["Known durable row one", "Known durable row two"];
const OFFLINE_BODIES = [
  "Offline FIFO alpha survives OS process death",
  "Offline FIFO beta survives OS process death",
] as const;
const LIVE_BODY = "Live update arrived through Expo streaming fetch";

type Message = { id: string; body: string; clientTag: string; ordinal: number; author: string; at: number };
type Boot = { stage: "online" | "restart-offline" | "final-relaunch"; boot: number; operationIds: string[] };
type Json = Record<string, unknown>;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${CONTROL_URL}${path}`, init);
  if (!response.ok) throw new Error(`control ${path} returned ${response.status}`);
  return response.json();
}

async function report(boot: Boot, phase: string, details: Json): Promise<void> {
  await request("/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: RUN_ID, boot: boot.boot, stage: boot.stage, phase,
      at: Date.now(), hermes: Boolean(global.HermesInternal), packageSha256: PACKAGE_SHA256,
      packageSourceSha256: PACKAGE_SOURCE_SHA256, details }),
  });
}

async function command(boot: Boot, expected: string, timeoutMs = 45_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await request(`/command?boot=${boot.boot}`);
    if (value.command === expected) return;
    await delay(200);
  }
  throw new Error(`timed out waiting for ${expected}`);
}

async function waitForMessages(resource: { getSnapshot(): ResourceSnapshot<Message[]> },
  required: readonly string[], timeoutMs = 30_000): Promise<Message[]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = resource.getSnapshot();
    const messages = value.data ?? [];
    if (required.every(body => messages.some(message => message.body === body))) return messages;
    await delay(100);
  }
  throw new Error(`messages did not include ${JSON.stringify(required)}`);
}

function operationJson(value: OperationSnapshot): Json {
  return { id: value.id, op: value.op, args: value.args, status: value.status,
    receipt: value.receipt ?? null, error: value.error ? { code: value.error.code, message: value.error.message } : null };
}

async function offlineProbes(): Promise<Json[]> {
  const probes: Json[] = [];
  for (const [name, path, init] of [
    ["content", "/api/manifest", undefined],
    ["auth", "/api/auth/persona", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "alice" }) }],
  ] as const) {
    try {
      const response = await expoFetch(`${BACKEND_URL}${path}`, init);
      probes.push({ name, failed: !response.ok, status: response.status, body: await response.text() });
    } catch (error) {
      probes.push({ name, failed: true, transportError: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!probes.every(probe => probe.failed === true)) throw new Error("an offline backend probe unexpectedly succeeded");
  return probes;
}

async function localMessages(client: ReturnType<typeof createExpoClient>): Promise<Message[]> {
  return await client.query<Message[]>("messages.page", { conversationId: ROOM, c: null });
}

export default function App() {
  const [headline, setHeadline] = useState("Starting native witness…");
  const [lines, setLines] = useState<string[]>([]);
  const note = (line: string) => { setHeadline(line); setLines(previous => [...previous.slice(-10), line]); };

  useEffect(() => {
    let active = true;
    void (async () => {
      const boot: Boot = await request("/boot");
      note(`Boot ${boot.boot}: ${boot.stage}`);
      if (!global.HermesInternal) throw new Error("HermesInternal is absent; this is not a Hermes witness");
      let uuidProbe: string | null = null;
      let uuidError: string | null = null;
      try { uuidProbe = randomUUID(); }
      catch (error) { uuidError = error instanceof Error ? error.message : String(error); }
      await report(boot, "native-module-probe", { types: { expoFetch: typeof expoFetch,
        randomUUID: typeof randomUUID, openDatabaseAsync: typeof openDatabaseAsync,
        textDecoder: typeof TextDecoder, structuredClone: typeof global.structuredClone,
        window: typeof window, windowAddEventListener: typeof window?.addEventListener,
        windowRemoveEventListener: typeof window?.removeEventListener },
        defaultDatabaseDirectory: String(defaultDatabaseDirectory), uuidProbe, uuidError });
      if (uuidError) throw new Error(`expo-crypto randomUUID failed: ${uuidError}`);

      // The proof intentionally exercises createExpoClient defaults: no databaseName,
      // storage, fetch, or idFactory is supplied.
      const client = createExpoClient({ url: BACKEND_URL });
      await report(boot, "client-created", { snapshot: client.getSnapshot() });
      if (boot.stage !== "online") client.setOnline(false);
      await client.ready;

      if (boot.stage === "online") {
        if (!client.getSnapshot().principal) await client.auth.persona("alice");
        const resource = client.watch<Message[]>("messages.page", { conversationId: ROOM, c: null });
        const unsubscribe = resource.subscribe(() => {});
        const first = await resource.refresh();
        if (first.status !== "ready" || !EXPECTED_SEEDS.every(body => first.data?.some(row => row.body === body))) {
          throw new Error("initial known rows were not acquired");
        }
        const acquisition = client.acquire({ id: "native-room-history", revision: "1",
          root: pages("messages.page", { conversationId: ROOM, c: null }) });
        const acquired = await acquisition.completed;
        await report(boot, "online-ready", { principal: client.getSnapshot().principal, resource: first,
          acquisition: acquired, messages: first.data });
        note("Authenticated, acquired, and SQLite-ready");

        await command(boot, "observe-live");
        const liveMessages = await waitForMessages(resource, [LIVE_BODY]);
        await report(boot, "live-update", { resource: resource.getSnapshot(), messages: liveMessages });
        note("Observed live SSE update");

        await command(boot, "queue-offline");
        client.setOnline(false);
        const probes = await offlineProbes();
        const firstOffline = client.mutate("messages.send", { conversationId: ROOM,
          body: OFFLINE_BODIES[0], clientTag: "offline-alpha" });
        const secondOffline = client.mutate("messages.send", { conversationId: ROOM,
          body: OFFLINE_BODIES[1], clientTag: "offline-beta" });
        await Promise.all([firstOffline.durable, secondOffline.durable]);
        const cached = await localMessages(client);
        await report(boot, "offline-queued", { probes, operationIds: [firstOffline.id, secondOffline.id],
          operations: [operationJson(firstOffline.getSnapshot()), operationJson(secondOffline.getSnapshot())],
          pending: client.getSnapshot().pending.map(operationJson), cached });
        note("Two FIFO operations durable while backend denied");
        unsubscribe();
        return;
      }

      const cached = await localMessages(client);
      const operations = boot.operationIds.map(id => client.operation(id));
      if (operations.some(operation => !operation)) throw new Error("an expected durable operation did not restore");

      if (boot.stage === "restart-offline") {
        const probes = await offlineProbes();
        await report(boot, "restored-offline", { probes, principal: client.getSnapshot().principal,
          cached, pending: client.getSnapshot().pending.map(operationJson),
          operations: operations.map(operation => operationJson(operation!.getSnapshot())) });
        note("OS relaunch restored cache and exact pending IDs");
        await command(boot, "reconnect");
        client.setOnline(true);
        const receipts = await Promise.all(operations.map(operation => operation!.settled));
        const resource = client.watch<Message[]>("messages.page", { conversationId: ROOM, c: null });
        const unsubscribe = resource.subscribe(() => {});
        await resource.refresh();
        const settledMessages = await waitForMessages(resource, OFFLINE_BODIES);
        await report(boot, "reconnected-settled", { receipts,
          operations: operations.map(operation => operationJson(operation!.getSnapshot())),
          pending: client.getSnapshot().pending.map(operationJson), messages: settledMessages });
        note("Original FIFO IDs settled once on server");
        unsubscribe();
        return;
      }

      await report(boot, "final-restored", { principal: client.getSnapshot().principal, cached,
        pending: client.getSnapshot().pending.map(operationJson),
        operations: operations.map(operation => operationJson(operation!.getSnapshot())) });
      note("Second OS relaunch restored terminal receipts");
    })().catch(async error => {
      const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
      note(`FAILED: ${message}`);
      try {
        const boot = await request("/boot");
        await report(boot, "app-failure", { message });
      } catch {}
    });
    return () => { active = false; void active; };
  }, []);

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>SNAPBACK 3 · EXPO · HERMES</Text>
      <Text style={styles.title}>Native persistence witness</Text>
      <View style={styles.card}>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.meta}>Hermes: {String(Boolean(global.HermesInternal))}</Text>
        <Text style={styles.meta}>Package: {PACKAGE_SHA256?.slice(0, 16)}</Text>
      </View>
      {lines.map((line, index) => <Text key={`${index}-${line}`} style={styles.line}>{line}</Text>)}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f3efe6" },
  content: { padding: 24, gap: 14 },
  eyebrow: { color: "#536b61", fontSize: 12, fontWeight: "700", letterSpacing: 1.6 },
  title: { color: "#17211d", fontSize: 34, fontWeight: "700", lineHeight: 40 },
  card: { backgroundColor: "#fffdf8", borderColor: "#cad5cd", borderWidth: 1,
    borderRadius: 18, padding: 20, gap: 8 },
  headline: { color: "#1c3329", fontSize: 19, fontWeight: "600", lineHeight: 26 },
  meta: { color: "#60726a", fontSize: 13 },
  line: { color: "#33463e", fontSize: 14, lineHeight: 20 },
});
