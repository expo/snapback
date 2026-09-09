import { useState } from "react";
import { api, intentLabel } from "snapback2/client";
import { DevOverlay, useAuth, useConnection, useOutbox, useQuery } from "snapback2/react";
import { Inbox, type LogRow } from "./Inbox";
import { Search } from "./Search";
import { Thread } from "./Thread";

export function App() {
  const connection = useConnection();
  const auth = useAuth();
  const outbox = useOutbox();
  const inbox = useQuery(api.messages.inbox, {}, { drain: true });
  const rows = (inbox.data ?? []) as LogRow[];
  const [selected, setSelected] = useState<string>();
  return (
    <main>
      <header>
        <h1>Snapback 2 chat</h1>
        <p role="status" data-connection={connection}>
          {connection === "connected" ? "Connected" : connection === "offline" ? "Offline" : "Reconnecting…"}
          {inbox.local.caughtUp ? " · log downloaded" : inbox.status === "loading" ? " · loading" : ""}
        </p>
        {outbox.entries.length > 0 ? <details><summary>Changes on this device ({outbox.entries.length})</summary><ul>
          {outbox.entries.map(entry => <li key={entry.intent}>{entry.op} · {intentLabel(entry)}
            {entry.state !== "queued" ? <button type="button" onClick={() => { void outbox.dismiss(entry.intent); }}>Dismiss</button> : null}
          </li>)}
        </ul></details> : null}
      </header>
      <Search onOpen={setSelected} />
      <Inbox rows={rows} selected={selected} onSelect={setSelected} />
      {selected ? <Thread conversationId={selected} viewer={auth.viewer} /> : <p>Pick a conversation.</p>}
      <DevOverlay />
    </main>
  );
}
