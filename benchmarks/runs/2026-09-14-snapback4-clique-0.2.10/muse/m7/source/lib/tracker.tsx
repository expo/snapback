import { useEffect, useRef } from "react";
import { useClient, useLink } from "snapback4/react";
import { api } from "../snapback/generated/api";

/**
 * Delivery tracker, mounted once in the authed tree. Whenever the client's
 * synced store shows message activity the viewer hasn't stamped yet, it
 * marks those conversations delivered — on every screen, including the feed.
 * Read receipts still come only from an open conversation.
 *
 * Heartbeat: the freshest conversation is marked on EVERY tick, not just on
 * advance. Each mutate drags a full device sync round, so this keeps inbound
 * data flowing even when the background follow loop parks (a parked loop
 * issues no long-polls and no syncs while one-shot reads and timers keep
 * working, freezing passive screens). The mark itself only stamps rows that
 * are genuinely undelivered for the viewer — usually a row-level no-op that
 * still pumps the sync it rides on.
 */
export function DeliveryTracker() {
  const client: any = useClient();
  const link = useLink();
  const lastMark = useRef<Record<string, number>>({});
  useEffect(() => {
    if (link !== "online") return;
    let live = true;
    let ticks = 0;
    const markOne = async (conversationId: string, heartbeat: boolean) => {
      try {
        const m = await client.mutate(api.markDelivered, { conversationId });
        if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
          // eslint-disable-next-line no-console
          console.log(`[delivery-tracker] ${heartbeat ? "beat" : "marked"} ${conversationId} -> ${JSON.stringify((m as any)?.state ?? m)}`);
        }
      } catch (e: any) {
        if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
          // eslint-disable-next-line no-console
          console.log(`[delivery-tracker] mark failed ${conversationId}: ${e?.message ?? e}`);
        }
      }
    };
    const t = setInterval(async () => {
      try {
        const r = await client.query(api.convLatest, {});
        ticks += 1;
        if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1" && ticks % 2 === 0) {
          // eslint-disable-next-line no-console
          console.log(`[delivery-tracker] tick link=${link} rows=${Array.isArray((r as any)?.data) ? (r as any).data.length : "?"} denied=${JSON.stringify((r as any)?.denied ?? null)}`);
        }
        if (!live || (r as any).denied || !(r as any).data) return;
        const rows = (r as any).data as any[];
        let freshest: any = null;
        for (const row of rows) {
          if (!freshest || row.at > freshest.at) freshest = row;
          if ((lastMark.current[row.conversationId] ?? 0) < row.at) {
            lastMark.current[row.conversationId] = row.at;
            await markOne(row.conversationId, false);
          }
        }
        // Heartbeat: re-mark the freshest conversation even with no advance.
        if (freshest) {
          lastMark.current[freshest.conversationId] = Math.max(
            lastMark.current[freshest.conversationId] ?? 0,
            freshest.at
          );
          await markOne(freshest.conversationId, true);
        }
      } catch {}
    }, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [client, link]);
  return null;
}
