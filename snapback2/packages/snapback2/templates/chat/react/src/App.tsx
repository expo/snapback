import { Auth } from "./Auth";
import { useState } from "react";
import { api, intentLabel } from "snapback2/client";
import { DevOverlay, useConnection, useOutbox, useQuery } from "snapback2/react";
import { Inbox, type LogRow } from "./Inbox";
import { Search } from "./Search";
import { Thread } from "./Thread";
import { NewConversation } from "./NewConversation";

export function App() { return <Auth><Home /></Auth>; }

function Home() {
  const connection = useConnection();
  const outbox = useOutbox();
  const inbox = useQuery(api.messages.inbox, { c: null }, { drain: true });
  const groups = useQuery(api.groups.mine, { c: null }, { drain: true });
  const rows = (inbox.data ?? []) as LogRow[];
  const [selected, setSelected] = useState<string>();
  const [note, setNote] = useState("");
  return (
    <main>
      <header>
        <h1>Snapback 2 chat</h1>
        <p role="status" data-connection={connection}>
          {connection === "connected" ? "Connected" : connection === "offline" ? "Offline" : "Reconnecting…"}
          {inbox.local.caughtUp ? " · log downloaded" : inbox.status === "loading" ? " · loading" : ""}
        </p>
        {note ? <p role="alert">{note}</p> : null}
        {outbox.entries.length > 0 ? <details><summary>Changes on this device ({outbox.entries.length})</summary><ul>
          {outbox.entries.map(entry => <li key={entry.intent}>{entry.op} · {intentLabel(entry)}
            {entry.state !== "queued" ? <button type="button" onClick={() => { void outbox.dismiss(entry.intent); }}>Dismiss</button> : null}
          </li>)}
        </ul></details> : null}
      </header>
      <Search onOpen={setSelected} />
      <Inbox groups={groups.data ?? []} rows={rows} selected={selected} onSelect={setSelected} />
      {selected ? <Thread conversationId={selected} onNote={setNote} /> : <p>Pick a conversation.</p>}
      <NewConversation onOpen={setSelected} />
      <DevOverlay />
    </main>
  );
}
