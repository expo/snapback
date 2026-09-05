// The delivery log is the app's source of truth on the device (LLP 1012 §3):
// every screen is a pure function over held log rows plus the durable outbox.
import type { Api, OutboxEntry } from "snapback2/client";

type ResultOf<T> = T extends { readonly __result?: infer Result } ? NonNullable<Result> : never;
export type LogRow = ResultOf<Api["deliveries"]["inbox"]>[number];
export type MessageRow = NonNullable<LogRow["message"]>;

export interface ConversationSummary {
  conversationId: string;
  latestAt: number;
  latestBody: string | undefined;
  messages: number;
}

/** One line per conversation, newest activity first, from the held log. */
export function conversations(rows: readonly LogRow[]): ConversationSummary[] {
  const byConversation = new Map<string, ConversationSummary>();
  for (const row of rows) {
    const current = byConversation.get(row.conversationId) ?? {
      conversationId: row.conversationId,
      latestAt: row.at,
      latestBody: undefined,
      messages: 0,
    };
    if (row.kind === "message") current.messages += 1;
    if (row.at >= current.latestAt) {
      current.latestAt = row.at;
      current.latestBody = row.message?.body ?? current.latestBody;
    }
    byConversation.set(row.conversationId, current);
  }
  return [...byConversation.values()].sort((a, b) => b.latestAt - a.latestAt);
}

export type PostArgs = { conversationId: string; body: string };
export type EditArgs = { messageId: string; body: string; baseBody: string };

export function postArgs(entry: OutboxEntry): PostArgs | undefined {
  const args = entry.args as Partial<PostArgs> | null;
  return entry.op === "deliveries.post" && args && typeof args.conversationId === "string" && typeof args.body === "string"
    ? { conversationId: args.conversationId, body: args.body }
    : undefined;
}

export function editArgs(entry: OutboxEntry): EditArgs | undefined {
  const args = entry.args as Partial<EditArgs> | null;
  return entry.op === "deliveries.edit" && args && typeof args.messageId === "string" && typeof args.body === "string"
    ? { messageId: args.messageId, body: args.body, baseBody: args.baseBody ?? "" }
    : undefined;
}

/** The label a settled or queued intent shows; never a client clock. */
export function intentLabel(entry: OutboxEntry): string {
  switch (entry.state) {
    case "queued": return entry.reason === "fence" ? "Will be checked by the server"
      : entry.predicted ? "Sending… · Preview" : "Sending… · Awaiting confirmation";
    case "committed": return "Sent";
    case "expired": return "Expired";
    case "rejected": {
      const response = entry.response as { reason?: string; code?: string; rewrite?: string; message?: string } | undefined;
      // @ref LLP 1012#7-writes-offline — a trace conflict, or the recipe's own
      // compare-and-set (`require msg.body = baseBody else CONFLICT`), reads the same.
      if (response?.reason === "conflict" || response?.code === "CONFLICT") return "Not sent · Message changed";
      return `Not sent · ${response?.rewrite ?? response?.message ?? response?.code ?? "refused"}`;
    }
  }
}

export type Bubble =
  | { key: string; kind: "row"; message: MessageRow; at: number; edit?: OutboxEntry }
  | { key: string; kind: "pending"; entry: OutboxEntry; body: string };

/**
 * The thread as bubbles: one per message id from the log (tombstoned ids
 * hidden), then the outbox's intents for this conversation. A pending post is
 * keyed by its first pinned id, the id the server row will carry, so the same
 * bubble becomes the row on `committed` and nothing jumps.
 */
export function threadBubbles(rows: readonly LogRow[], entries: readonly OutboxEntry[], conversationId: string): Bubble[] {
  const hidden = new Set(rows.filter((row) => row.kind === "removed" || row.kind === "expired").map((row) => row.messageId));
  const edits = new Map(entries.map((entry) => [editArgs(entry)?.messageId, entry] as const).filter(([id]) => id !== undefined));
  const seen = new Set<string>();
  const bubbles: Bubble[] = [];
  // @ref LLP 1012#7-writes-offline — a queued send the twin predicted is inside
  // the log's rows under its pinned id; it is still the pending bubble, with
  // `args.body` and "Sending…" and no time, until the server's row settles it.
  const pending = new Map(entries
    .filter((entry) => entry.state === "queued" && postArgs(entry) !== undefined)
    .map((entry) => [entry.ids[0] ?? entry.intent, entry] as const));
  // The log's thread page is newest-first (`last 50`); a thread reads oldest-first.
  const chronological = [...rows].sort((a, b) => a.at - b.at || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0));
  for (const row of chronological) {
    if (row.kind !== "message" || !row.message || hidden.has(row.messageId) || seen.has(row.messageId)) continue;
    seen.add(row.messageId);
    const predicted = pending.get(row.messageId);
    if (predicted) {
      bubbles.push({ key: row.messageId, kind: "pending", entry: predicted, body: postArgs(predicted)!.body });
      continue;
    }
    const edit = edits.get(row.messageId);
    bubbles.push({ key: row.messageId, kind: "row", message: row.message, at: row.at, ...(edit ? { edit } : {}) });
  }
  for (const entry of entries) {
    const args = postArgs(entry);
    if (!args || args.conversationId !== conversationId) continue;
    const key = entry.ids[0] ?? entry.intent;
    if (seen.has(key)) continue;
    bubbles.push({ key, kind: "pending", entry, body: args.body });
  }
  return bubbles;
}

/** Committed posts whose server row is now held can leave the outbox. */
export function settledByRows(rows: readonly LogRow[], entries: readonly OutboxEntry[]): OutboxEntry[] {
  const held = new Set(rows.map((row) => row.messageId));
  return entries.filter((entry) => entry.state === "committed" && postArgs(entry) !== undefined && held.has(entry.ids[0] ?? ""));
}

/** Offline search is a filter over the downloaded log (LLP 1012 §6); it finds nothing evicted. */
export function searchHeld(rows: readonly LogRow[], term: string): LogRow[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const body = row.message?.body;
    if (row.kind !== "message" || !body || seen.has(row.messageId) || !body.toLowerCase().includes(needle)) return false;
    seen.add(row.messageId);
    return true;
  });
}
