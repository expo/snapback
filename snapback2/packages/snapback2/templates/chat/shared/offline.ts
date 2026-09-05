import type { ConnectionState, OutboxStatus } from "snapback2/client";

type StoredRow = { table: string; row: Record<string, unknown> };

export const chatOffline = {
  onTombstone: (item: StoredRow) =>
    item.table === "deliveries" && (item.row.kind === "removed" || item.row.kind === "expired")
      && typeof item.row.messageId === "string" ? [{ table: "messages", id: item.row.messageId }] : [],
  // Optional on the recipe's message row; absent/null is ordinary media.
  viewOnce: (table: string, row: Record<string, unknown>) => table === "messages" && row.viewOnce === true,
};

/** Both composers explain recovery without exposing grant slices or protocol details. */
export function sendingStatus(status: OutboxStatus, connection: ConnectionState, queued: number) {
  if (!status.ready) {
    const messages = {
      ready: "Preparing to send…",
      sealed: "Sign in again to send your saved messages.",
      "grant-missing": "Connect to enable sending. Queued messages stay saved.",
      "grant-expired": "Reconnect to enable new messages. Queued messages stay saved.",
      "ids-exhausted": "Reconnect to continue sending. Queued messages stay saved.",
      "program-missing": "Connect to download this conversation before sending.",
    };
    return { reason: status.reason, message: messages[status.reason], canSync: status.action === "resume" || status.action === "load-program" };
  }
  if (status.fence === "past") return { reason: "fence", message: "Queued until the next sync.", canSync: true };
  if (queued > 0) return {
    reason: connection === "connected" ? "pending" : "connection",
    message: `${queued} queued · ${connection === "connected" ? "Waiting for the server." : "Waiting for connection."}`,
    canSync: true,
  };
  return undefined;
}
