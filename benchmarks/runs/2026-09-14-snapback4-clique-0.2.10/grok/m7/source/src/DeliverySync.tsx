import React, { useEffect, useRef } from "react";
import { useClient, useMutation } from "snapback4/react";
import { api } from "./api.generated";

/** Marks inbound receipts delivered while the app is online, even off the thread. */
export function DeliverySync(): React.JSX.Element | null {
  const client = useClient();
  const mark = useMutation(api.markDelivered);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const inbox = await client.query(api.inbox, {});
        if (cancelled || "denied" in inbox || "loading" in inbox) return;
        for (const item of inbox.data ?? []) {
          if (!item.conversationId) continue;
          const read = await client.query(api.inboxReceipts, { conversationId: item.conversationId });
          if ("denied" in read || "loading" in read) continue;
          for (const row of read.data ?? []) {
            if (row.delivered || seen.current.has(row.messageId)) continue;
            seen.current.add(row.messageId);
            void mark.run({ messageId: row.messageId });
          }
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 400);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, mark]);

  return null;
}
