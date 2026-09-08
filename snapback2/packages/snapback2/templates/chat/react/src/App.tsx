import { useState } from "react";
import { api } from "snapback2/client";
import { DevOverlay, useAuth, useConnection, useQuery } from "snapback2/react";
import { Inbox } from "./Inbox";
import { Search } from "./Search";
import { Thread } from "./Thread";

// @ref LLP 1012#3-the-model-on-one-page-and-the-program-shape — one drained
// delivery log is "everything on the phone"; the inbox, every thread, and
// search read the same held rows.
// @ref LLP 1018.003#1-the-snapshot-record — a screen reads `data`, `status`,
// and `reason`; the receipt, freshness, and local facts stay one property down.
export function App() {
  const connection = useConnection();
  const auth = useAuth();
  const inbox = useQuery(api.deliveries.inbox, { c: null }, { drain: true });
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
      </header>
      <Search rows={inbox.data ?? []} onOpen={setSelected} />
      <Inbox rows={inbox.data ?? []} selected={selected} onSelect={setSelected} />
      {selected ? <Thread conversationId={selected} viewer={auth.viewer} onNote={setNote} /> : <p>Pick a conversation.</p>}
      <DevOverlay />
    </main>
  );
}
