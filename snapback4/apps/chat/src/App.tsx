import { useMemo, useState } from "react";
import type { Principal } from "snapback4/contract";
import { createMockClient } from "snapback4/mock";
import { SnapbackProvider, useLink, useClient } from "snapback4/react";
import { ops, seed } from "../mock/api.ts";
import { Inbox } from "./Inbox.tsx";
import { Thread } from "./Thread.tsx";

const viewer = "dev:alice" as Principal;

export function App() {
  // MOCK client: the app is real, the client is not (LLP 2000 §4).
  const client = useMemo(() => createMockClient({ viewer, tables: seed(viewer), ops, commitDelayMs: 400 }), []);
  return <SnapbackProvider client={client}><Home /></SnapbackProvider>;
}

function Home() {
  const [selected, setSelected] = useState<string | undefined>("c1");
  return <>
    <Inbox selected={selected} onSelect={setSelected} />
    <main>
      <LinkBar />
      {selected ? <Thread conversationId={selected} /> : <p>Pick a conversation.</p>}
    </main>
  </>;
}

function LinkBar() {
  const link = useLink();
  const client = useClient() as ReturnType<typeof createMockClient>;
  return <header>
    <strong>Snapback 4 chat</strong>
    <span role="status">{link === "online" ? "Online" : link === "offline" ? "Offline" : "Signed out"}</span>
    <button type="button" onClick={() => client.setLink(link === "online" ? "offline" : "online")}>{link === "online" ? "Go offline" : "Go online"}</button>
    <small className="note">MOCK client — no server behind this page</small>
  </header>;
}
