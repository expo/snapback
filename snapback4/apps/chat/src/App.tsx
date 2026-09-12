import { useMemo, useState } from "react";
import { createClient } from "snapback4/client";
import { SnapbackProvider, useLink } from "snapback4/react";
import { Inbox } from "./Inbox.tsx";
import { Thread } from "./Thread.tsx";

// The real client on the online tier: `snapback4 dev` serves snapback/schema.q
// at 127.0.0.1:4400; the persona comes from the URL (?as=bob), default alice.
const persona = new URLSearchParams(location.search).get("as") ?? "alice";
const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400";

export function App() {
  const client = useMemo(() => createClient({ url, persona }), []);
  return <SnapbackProvider client={client}><Home /></SnapbackProvider>;
}

function Home() {
  const [selected, setSelected] = useState<string | undefined>(undefined);
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
  return <header>
    <strong>Snapback 4 chat</strong>
    <span role="status">{link === "online" ? "Online" : link === "offline" ? "Offline" : "Signed out"}</span>
    <small className="note">as {persona} · {url}</small>
  </header>;
}
