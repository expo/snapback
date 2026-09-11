import { Auth } from "./Auth";
import { useState } from "react";
import { api } from "snapback2/client";
import { DevOverlay, useConnection, useOutbox, useQuery } from "snapback2/react";
import { Inbox, type LogRow } from "./Inbox";
import { Search } from "./Search";
import { Thread } from "./Thread";
import { NewConversation } from "./NewConversation";

export function App() { return <Auth><Home /></Auth>; }

function Home() {
  const connection = useConnection();
  const outbox = useOutbox();
  const inbox = useQuery(api.messages.inbox, {}, { drain: true });
  const groups = useQuery(api.groups.mine, {}, { drain: true });
  const rows = (inbox.data ?? []) as LogRow[];
  const [selected, setSelected] = useState<string>();
  return (
    <main>
      <header>
        <h1>Snapback 2 chat</h1>
        <p role="status" data-connection={connection}>
          {connection === "connected" ? "Connected" : connection === "offline" ? "Offline" : "Reconnecting…"}
          {inbox.local.caughtUp ? " · messages available on this device" : inbox.status === "loading" ? " · loading" : ""}
        </p>
        {outbox.work.length > 0 ? <details><summary>Changes on this device ({outbox.work.length})</summary><ul>
          {outbox.work.map(({ entry, label, dismissible }) => <li key={entry.intent}>{label}
            {dismissible ? <button type="button" onClick={() => { void outbox.dismiss(entry.intent); }}>Dismiss</button> : null}
            <details><summary>Details</summary><pre>{JSON.stringify({ operation: entry.op, refusal: entry.refusal, result: entry.response }, null, 2)}</pre></details>
          </li>)}
        </ul></details> : null}
      </header>
      <Search onOpen={setSelected} />
      <Inbox groups={groups.data ?? []} rows={rows} selected={selected} onSelect={setSelected} />
      {selected ? <Thread conversationId={selected} /> : <p>Pick a conversation.</p>}
      <NewConversation onOpen={setSelected} />
      <DevOverlay />
    </main>
  );
}
