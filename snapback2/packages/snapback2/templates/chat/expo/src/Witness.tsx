import { twinLastDecline, witnessSearchProbe } from "snapback2/expo/witness";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api, SnapbackRefusal, type AssetRecord, type ImageAsset, type RangeStore, type SnapbackClient, type Subscription } from "snapback2/client";
import { createExpoClient, expoSqliteStore, expoSqliteDriver, SnapbackProvider } from "snapback2/expo";
import { MediaView, type Media } from "./MediaView";
import { messageWrites } from "../shared/thread";
import { witnessControl, runSqliteDriverConformance, type WitnessHooks } from "snapback2/expo/witness";
type LogRow = { kind?: string; messageId: string; conversationId: string; message?: { body?: string | null } | null };
type Entry = Awaited<ReturnType<SnapbackClient["outbox"]["entries"]>>[number];
function bubbles(rows: LogRow[], entries: Entry[], conversationId: string) {
  const live = rows.filter((row) => row.kind === "message" && row.message);
  const placed = live.map((row) => ({ key: row.messageId,
    kind: entries.some((entry) => entry.op === "messages.send" && entry.state === "queued" && messageWrites.create.id(entry) === row.messageId) ? "pending" : "row" }));
  const unplaced = entries.filter((entry) => entry.op === "messages.send"
    && (entry.args as { conversationId?: string }).conversationId === conversationId && !live.some((row) => row.messageId === messageWrites.create.id(entry)))
    .map((entry) => ({ key: messageWrites.create.id(entry) ?? entry.intent, kind: "pending" }));
  return [...placed, ...unplaced];
}
import { configuration, persist, databaseState, markerSwap, listFiles, DATABASE } from "./witness-state";
import { Chat } from "./Chat";
import { composedFacts } from "./composed-facts";

export default function Witness({ url, controlUrl }: { url: string; controlUrl: string }) {
  const [client, setClient] = useState<SnapbackClient>();
  const [media, setMedia] = useState<Media>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live: SnapbackClient | undefined, store: RangeStore | undefined, selected = "conversation-1";
    let subscriptions: Subscription<unknown>[] = [];
    let currentMedia: Media | undefined, viewNonce = 0;
    const dispose = async () => { for (const sub of subscriptions) sub.close(); subscriptions = []; await live?.close(); live = undefined; setClient(undefined); };
    const construct = async (hooks: WitnessHooks, args: Record<string, unknown>) => {
      await dispose();
      if (args.fresh === true) {
        const initial = expoSqliteStore(DATABASE)();
        try { await initial.wipe("dev:alice"); } finally { await initial.close?.(); }
        await persist({ name: "alice", offline: false, fault: "none" });
      }
      if (typeof args.name === "string") await persist({ name: args.name });
      if (Array.isArray(args.assets)) await persist({
        ...(Array.isArray(args.assets) ? { assets: args.assets as AssetRecord[] } : {}),
      });
      const config = await configuration();
      store = expoSqliteStore(DATABASE, { beforeCommit: hooks.beforeCommit })();
      if (config.fault === "carrier") store.open = async () => { throw new SnapbackRefusal({
        code: "E_OFFLINE_CARRIER", family: "offline", site: "witness construct", message: "persisted witness carrier fault",
        rewrite: "send fault(none), then construct", guide: "offline",
      }); };
      live = createExpoClient({ url, as: config.name, startOffline: config.offline,
        offline: { store: () => store! } });
      try { await live.ready; setClient(live); setError(undefined); return live; }
      catch (error) { setError(String(error)); throw error; }
    };
    const control = witnessControl({ construct, persist,
      async command(client, verb, args) {
        // The carrier can be read before any client constructs: the harness inspects a
        // reopened database before the app mounts anything that writes to it.
        if (verb === "stores") return { stores: await databaseState(), files: listFiles() };
        if (!client || !store) throw new Error("construct first");
        if (verb === "drain") {
          const sub = client.subscribe(api.messages.inbox, { c: null }, () => {}, { drain: true });
          subscriptions.push(sub);
          return sub.until((value) => "caughtUp" in value && value.caughtUp === true);
        }
        if (verb === "open") {
          selected = String(args.conversationId);
          const queryArgs = { conversationId: selected };
          const first = client.subscribe(api.messages.conversationView, queryArgs, () => {});
          const second = client.subscribe(api.messages.conversationView, queryArgs, () => {});
          const [left, right] = await Promise.all([
            first.until((value) => value.state === "complete" || value.state === "capped"),
            second.until((value) => value.state === "complete" || value.state === "capped"),
          ]);
          if ((left.state !== "complete" && left.state !== "capped")
            || (right.state !== "complete" && right.state !== "capped")) throw new Error("conversation view did not resolve");
          const two = client.sharedConsumers(api.messages.conversationView, queryArgs);
          first.close();
          const one = client.sharedConsumers(api.messages.conversationView, queryArgs);
          subscriptions.push(second);
          // Retain the paginated read's independent receipt for partial-history fallback.
          await client.query(api.messages.thread, { conversationId: selected, c: null });
          // Media mutations predate the delivery recipe; drain this named read to
          // hold their row leases too (messages.sendPhoto has no delivery fanout).
          await client.query(api.messages.thread, { conversationId: selected, c: null });
          return { state: left.state, sameValue: left.data === right.data, consumers: [two, one],
            next: [left.next, right.next], data: left.data };
        }
        if (verb === "send") return client.mutation(messageWrites.create, {
          conversationId: typeof args.conversationId === "string" ? args.conversationId : selected, body: String(args.body),
        });
        if (verb === "view") {
          const config = await configuration();
          const asset = config.assets.find((asset) => asset.id === args.assetId) as AssetRecord | undefined;
          if (!asset) throw new Error("unknown witness asset");
          const once = Boolean(await client.assetCache?.viewOnce(asset.id) || await client.assetCache?.viewed(asset.id));
          const result = await new Promise<Record<string, unknown>>((resolve) => {
            currentMedia = { asset, nonce: ++viewNonce, once, hidden: args.hidden === true,
              loaded: false, resolve: (value) => resolve(value as Record<string, unknown>) };
            setMedia(currentMedia);
          });
          if (!once && result.loaded === true) {
            // The ordinary source may first load from memory; acknowledge only
            // the materialized file, after the bridge's directory reports it.
            // Compare paths, not spellings: the bridge's URI percent-encodes the partition
            // (`dev%3Aalice`) while the directory listing may not.
            const path = (uri: string) => decodeURIComponent(uri).replace(/\/+$/, "");
            const served = path(String(result.uri));
            const deadline = Date.now() + 10_000;
            while (!listFiles().some((file) => path(file) === served)) {
              if (Date.now() >= deadline) throw new Error(`ordinary media did not materialize a file: served ${result.uri}; listed ${JSON.stringify(listFiles().slice(0, 6))}`);
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          }
          return { ...result, viewed: await client.assetCache?.viewed(asset.id),
            files: listFiles().filter((file) => file.includes(asset.id)) };
        }

        if (verb === "swap") {
          if (args.phase !== "pre" && args.phase !== "post") throw new Error("swap needs pre or post");
          await markerSwap(store, args.phase, await client.outbox.entries());
          return { phase: args.phase };
        }
        if (verb === "conformance") return runSqliteDriverConformance(() => expoSqliteDriver("snapback2-conformance.db"));
        if (verb === "settled") {
          // A retryable refusal stops the replay and keeps the intent queued; the supported
          // retry is an explicit drain of the same envelope, then settled again (LLP 1012 §7).
          await client.outbox.settled();
          if ((await client.outbox.entries()).some((entry) => entry.state === "queued")) {
            await client.outbox.drain();
            await client.outbox.settled();
          }
          const entries = await client.outbox.entries();
          if (entries.some((entry) => entry.state === "queued")) throw new Error("outbox did not settle");
          return entries;
        }
        if (verb === "state") {
          const composed = typeof args.conversationId === "string" ? await composedFacts(client, args.conversationId) : undefined;
          const answer = typeof args.conversationId === "string"
            ? await client.query(api.messages.thread, { conversationId: args.conversationId, c: null }) : undefined;
          const conversationView = typeof args.conversationId === "string"
            ? await client.query(api.messages.conversationView, { conversationId: args.conversationId }) : undefined;
          const entries = await client.outbox.entries();
          const rows = answer && "data" in answer && Array.isArray(answer.data) ? answer.data : [];
          const search = typeof args.search === "string"
            ? await client.query(api.messages.search, { term: args.search, c: null }) : undefined;
          const diagnosticTerms = ["caf", "café"];
          const searchVariants = args.searchDiagnostics === true ? Object.fromEntries(await Promise.all([
            ["ascii", diagnosticTerms[0]], ["precomposed", diagnosticTerms[1]],
          ].map(async ([name, term]) => [name, await client.query(api.messages.search, { term, c: null })]))) : undefined;
          return { snapshot: client.snapshot, coverage: await store.coverage(), outbox: entries,
            bubbles: typeof args.conversationId === "string" ? bubbles(rows as LogRow[], entries as Entry[], args.conversationId) : [],
            search, searchVariants, searchProbe: args.searchDiagnostics === true
              ? witnessSearchProbe(client, [...diagnosticTerms, String(args.search)]) : undefined,
            answer, conversationView, composed, twin: twinLastDecline(), stores: await databaseState(), files: listFiles(),
            media: currentMedia ? { loaded: currentMedia.loaded, uri: currentMedia.uri } : null };
        }
        throw new Error(`unknown witness command ${verb}`);
      },
    }, controlUrl);
    return () => { control.close(); void dispose(); };
  }, [url, controlUrl]);
  return client ? <SnapbackProvider client={client}><View style={{ flex: 1 }}><Chat />{media ? <MediaView key={media.nonce} media={media} /> : null}</View></SnapbackProvider>
    : <Text>{error ?? "Witness connected; waiting for construct."}</Text>;
}
