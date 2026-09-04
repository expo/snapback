import { useState } from "react";
import { api } from "snapback2/client";
import { DevOverlay, useAuth, useConnection, useQuery } from "snapback2/react";
import { Inbox } from "./chat/Inbox";
import { Search } from "./chat/Search";
import { Thread } from "./chat/Thread";
import type { LogRow } from "./chat/log";

// @ref LLP 1012#3-the-model-on-one-page-and-the-program-shape — one drained
// delivery log is "everything on the phone"; the inbox, every thread, and
// search read the same held rows.
export function App() {
  const connection = useConnection();
  const auth = useAuth();
  const inbox = useQuery(api.deliveries.inbox, { c: null }, { drain: true });
  const rows: LogRow[] = "data" in inbox && Array.isArray(inbox.data) ? inbox.data : [];
  const [selected, setSelected] = useState<string>();
  const [note, setNote] = useState("");
  const caughtUp = "caughtUp" in inbox && inbox.caughtUp === true;
  return (
    <main>
      <header>
        <h1>Snapback 2 chat</h1>
        <p role="status" data-connection={connection}>
          {connection === "connected" ? "Connected" : connection === "offline" ? "Offline" : "Reconnecting…"}
          {caughtUp ? " · log downloaded" : inbox.state === "hydrating" ? " · loading" : ""}
        </p>
        {note ? <p role="alert">{note}</p> : null}
      </header>
      <Search rows={rows} onOpen={setSelected} />
      <Inbox rows={rows} selected={selected} onSelect={setSelected} />
      {selected ? <Thread conversationId={selected} viewer={auth.viewer} onNote={setNote} /> : <p>Pick a conversation.</p>}
      <DevOverlay />
    </main>
  );
}
