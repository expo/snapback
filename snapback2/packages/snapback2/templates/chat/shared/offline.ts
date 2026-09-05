type StoredRow = { table: string; row: Record<string, unknown> };

export const chatOffline = {
  onTombstone: (item: StoredRow) =>
    item.table === "deliveries" && (item.row.kind === "removed" || item.row.kind === "expired")
      && typeof item.row.messageId === "string" ? [{ table: "messages", id: item.row.messageId }] : [],
  // Optional on the recipe's message row; absent/null is ordinary media.
  viewOnce: (table: string, row: Record<string, unknown>) => table === "messages" && row.viewOnce === true,
};
