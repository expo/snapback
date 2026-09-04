type StoredRow = { table: string; row: Record<string, unknown> };

export const chatOffline = {
  onTombstone: (item: StoredRow) =>
    item.table === "deliveries" && (item.row.kind === "removed" || item.row.kind === "expired")
      && typeof item.row.messageId === "string" ? [{ table: "messages", id: item.row.messageId }] : [],
  // The recipe has no one-use delivery column yet. Apps supply the set of
  // view-once message ids; the witness persists its set before construction.
};
