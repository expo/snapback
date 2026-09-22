import { isReady } from "snapback4/contract";
import { useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

export function Inbox({ selected, onSelect }: { selected: string | undefined; onSelect(id: string): void }) {
  const inbox = useQuery(api.inbox, {});
  return <nav aria-label="Inbox">
    {isReady(inbox) && !inbox.complete ? <p>More conversations may be available online.</p> : null}
    {isReady(inbox) && !inbox.fresh ? <small>Saved conversations</small> : null}
    {isReady(inbox) ? inbox.data.map((row) => (
      <button key={row.conversationId} type="button" aria-current={row.conversationId === selected ? "true" : undefined} onClick={() => onSelect(row.conversationId)}>
        <strong>{row.conversation?.title ?? row.conversationId}</strong> <small>{row.count}</small>
      </button>
    )) : <p>{"denied" in inbox ? inbox.denied.message : "Loading…"}</p>}
  </nav>;
}
