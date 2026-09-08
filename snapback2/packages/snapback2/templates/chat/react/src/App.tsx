import { useState } from "react";
import { api } from "snapback2/client";
import { DevOverlay, useAuth, useConnection, useQuery, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react";
import { Inbox, type LogRow } from "./Inbox";
import { Search } from "./Search";
import { Thread } from "./Thread";
import { useAccountRecoveryCustody, type MessageChangeUncertainty, type SendUncertainty } from "../shared/recovery";

// @ref LLP 1012#3-the-model-on-one-page-and-the-program-shape — one drained
// delivery log is "everything on the phone"; the inbox and retained-history
// fallback read the same held rows while named search stays indexed.
// @ref LLP 1018.003#1-the-snapshot-record — screens read the snapshot axes;
// status and reason are derived by the SDK.
export function App() {
  const connection = useConnection();
  const auth = useAuth();
  const client = useSnapbackClient();
  const authGeneration = useSnapbackSnapshot().authGeneration;
  const sendCustody = useAccountRecoveryCustody<SendUncertainty>(client, authGeneration);
  const changeCustody = useAccountRecoveryCustody<MessageChangeUncertainty>(client, authGeneration);
  const inbox = useQuery(api.deliveries.inbox, { c: null }, { drain: true });
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
      </header>
      <Search onOpen={setSelected} />
      <Inbox rows={rows} selected={selected} onSelect={setSelected} />
      {selected ? <Thread conversationId={selected} viewer={auth.viewer} onNote={setNote}
        sendCustody={sendCustody} changeCustody={changeCustody} /> : <p>Pick a conversation.</p>}
      <DevOverlay />
    </main>
  );
}
