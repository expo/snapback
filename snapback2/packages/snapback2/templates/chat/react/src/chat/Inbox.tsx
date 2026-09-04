import { useMemo } from "react";
import { conversations, type LogRow } from "./log";

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
