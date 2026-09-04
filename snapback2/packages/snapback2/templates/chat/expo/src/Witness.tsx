import React, { useEffect, useState } from "react";
import { PixelRatio, Text, View } from "react-native";
import { api, SnapbackRefusal, type AssetRecord, type ImageAsset, type RangeStore, type SnapbackClient, type Subscription } from "snapback2/client";
import { createExpoClient, expoSqliteStore, expoSqliteDriver, SnapbackProvider } from "snapback2/expo";
import { AssetImage, useAssetFile } from "snapback2/react-native";
import { witnessControl, runSqliteDriverConformance, type WitnessHooks } from "snapback2/expo/witness";
import { chatOffline } from "../shared/offline.js";
import { searchHeld, threadBubbles } from "../shared/log.js";
import { configuration, persist, databaseState, markerSwap, listFiles, DATABASE } from "./witness-state";
import { Chat } from "./Chat";

interface Media { asset: ImageAsset; loaded: boolean; uri?: string; resolve(value: unknown): void }
function MediaView({ media }: { media: Media }) {
  const uri = useAssetFile(media.asset, { width: 64 * PixelRatio.get() });
  useEffect(() => { media.uri = uri; }, [media, uri]);
  return <AssetImage asset={media.asset} width={64} testID="witness-media" onLoad={() => {
    media.loaded = true; media.uri = uri;
    media.resolve({ loaded: true, uri: uri ?? "memory" });
  }} onRefusal={(error) => media.resolve({ loaded: false, refusal: error.envelope })} />;
}

export default function Witness({ url, controlUrl }: { url: string; controlUrl: string }) {
  const [client, setClient] = useState<SnapbackClient>();
  const [media, setMedia] = useState<Media>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live: SnapbackClient | undefined, store: RangeStore | undefined, selected = "conversation-1";
    let subscriptions: Subscription<unknown>[] = [];
    let currentMedia: Media | undefined;
    const dispose = async () => { for (const sub of subscriptions) sub.close(); subscriptions = []; await live?.close(); live = undefined; setClient(undefined); };
    const construct = async (hooks: WitnessHooks, args: Record<string, unknown>) => {
      await dispose();
      if (args.fresh === true) {
        const initial = expoSqliteStore(DATABASE)();
        try { await initial.wipe("dev:alice"); } finally { await initial.close?.(); }
        await persist({ name: "alice", offline: false, fault: "none" });
      }
      if (typeof args.name === "string") await persist({ name: args.name });
      if (Array.isArray(args.once) || Array.isArray(args.assets)) await persist({
        ...(Array.isArray(args.once) ? { once: args.once as string[] } : {}),
        ...(Array.isArray(args.assets) ? { assets: args.assets as AssetRecord[] } : {}),
      });
      const config = await configuration();
      store = expoSqliteStore(DATABASE, { beforeCommit: hooks.beforeCommit })();
      if (config.fault === "carrier") store.open = async () => { throw new SnapbackRefusal({
        code: "E_OFFLINE_CARRIER", family: "offline", site: "witness construct", message: "persisted witness carrier fault",
        rewrite: "send fault(none), then construct", guide: "offline",
      }); };
      live = createExpoClient({ url, as: config.name, startOffline: config.offline,
        offline: { ...chatOffline, store: () => store!, viewOnce: (table, row) => table === "messages" && config.once.includes(String(row.id)) } });
      try { await live.ready; setClient(live); setError(undefined); return live; }
      catch (error) { setError(String(error)); throw error; }
    };
    const control = witnessControl({ construct, persist,
      async command(client, verb, args) {
        if (!client || !store) throw new Error("construct first");
        if (verb === "drain") {
          const sub = client.subscribe(api.deliveries.inbox, { c: null }, () => {}, { drain: true });
          subscriptions.push(sub);
          return sub.until((value) => "caughtUp" in value && value.caughtUp === true);
        }
        if (verb === "open") {
          selected = String(args.conversationId);
          const sub = client.subscribe(api.deliveries.thread, { conversationId: selected, c: null }, () => {});
          subscriptions.push(sub);
          await sub.until((value) => value.state === "complete");
          // Media mutations predate the delivery recipe; drain this named read to
          // hold their row leases too (messages.sendPhoto has no delivery fanout).
          await client.query(api.messages.thread, { conversationId: selected, c: null });
          return client.query(api.deliveries.thread, { conversationId: selected, c: null });
        }
        if (verb === "send") return client.mutation(api.deliveries.post, {
          conversationId: typeof args.conversationId === "string" ? args.conversationId : selected, body: String(args.body),
        });
        if (verb === "view") {
          const config = await configuration();
          const asset = config.assets.find((asset) => asset.id === args.assetId) as ImageAsset | undefined;
          if (!asset) throw new Error("unknown witness asset");
          if (args.hidden === true) {
            // Mount a fresh viewing instance: do not manufacture a non-render by
            // hiding the component. A viewed photo must supply no native source.
            const probe: Media = { asset, loaded: false, resolve() {} };
            currentMedia = probe; setMedia(probe);
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            return { loaded: probe.loaded, uri: probe.uri, viewed: await client.assetCache?.viewed(asset.id),
              files: listFiles().filter((file) => file.includes(asset.id)) };
          }
          return new Promise((resolve) => {
            currentMedia = { asset, loaded: false, resolve };
            setMedia(currentMedia);
          });
        }
        if (verb === "swap") {
          if (args.phase !== "pre" && args.phase !== "post") throw new Error("swap needs pre or post");
          await markerSwap(store, args.phase, await client.outbox.entries());
          return { phase: args.phase };
        }
        if (verb === "conformance") return runSqliteDriverConformance(() => expoSqliteDriver("snapback2-conformance.db"));
        if (verb === "settled") {
          const deadline = Date.now() + 20_000;
          while ((await client.outbox.entries()).some((entry) => entry.state === "queued")) {
            if (Date.now() > deadline) throw new Error("outbox did not settle");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return client.outbox.entries();
        }
        if (verb === "state") {
          const answer = typeof args.conversationId === "string"
            ? await client.query(api.deliveries.thread, { conversationId: args.conversationId, c: null }) : undefined;
          const entries = await client.outbox.entries();
          const rows = answer && "data" in answer && Array.isArray(answer.data) ? answer.data : [];
          return { snapshot: client.snapshot, coverage: await store.coverage(), outbox: entries,
            bubbles: typeof args.conversationId === "string" ? threadBubbles(rows, entries, args.conversationId) : [],
            search: typeof args.search === "string" ? searchHeld(rows, args.search) : [],
            answer, stores: await databaseState(), files: listFiles(), media: currentMedia ? { loaded: currentMedia.loaded, uri: currentMedia.uri } : null };
        }
        throw new Error(`unknown witness command ${verb}`);
      },
    }, controlUrl);
    return () => { control.close(); void dispose(); };
  }, [url, controlUrl]);
  return client ? <SnapbackProvider client={client}><View style={{ flex: 1 }}><Chat />{media ? <MediaView key={media.asset.id} media={media} /> : null}</View></SnapbackProvider>
    : <Text>{error ?? "Witness connected; waiting for construct."}</Text>;
}
