import { useMemo } from "react";
import type { Api, ResultOf } from "snapback2/client";

/** One row of the drained delivery log; the inbox, search, and every thread read the same held rows. */
export type LogRow = ResultOf<Api["messages"]["inbox"]>[number];

function conversations(rows: readonly LogRow[]) {
  const byConversation = new Map<string, { conversationId: string; latestAt: number; latestBody?: string; messages: number }>();
  for (const row of rows) {
    const current = byConversation.get(row.conversationId) ?? { conversationId: row.conversationId, latestAt: row.at, messages: 0 };
    if (row.kind === "message") current.messages += 1;
    if (row.at >= current.latestAt) {
      current.latestAt = row.at;
      current.latestBody = row.message?.body ?? current.latestBody;
    }
    byConversation.set(row.conversationId, current);
  }
  return [...byConversation.values()].sort((a, b) => b.latestAt - a.latestAt);
}

export function Inbox({ rows, selected, onSelect }: {
  rows: readonly LogRow[];
  selected: string | undefined;
  onSelect(conversationId: string): void;
}) {
  const items = useMemo(() => conversations(rows), [rows]);
  return (
    <nav aria-label="Inbox">
      <ul>
        {items.map((item) => (
          <li key={item.conversationId} data-conversation={item.conversationId} aria-current={item.conversationId === selected ? "true" : undefined}>
            <button type="button" onClick={() => onSelect(item.conversationId)}>
              <strong>{item.conversationId}</strong>
              <span>{item.latestBody ?? `${item.messages} messages`}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
