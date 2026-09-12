import { useEffect, useState } from "react";
import type { Client } from "snapback4/contract";
import { createLocalClient } from "snapback4/local";
import { SnapbackProvider, useLink } from "snapback4/react";
import { Inbox } from "./Inbox.tsx";
import { Thread } from "./Thread.tsx";

// The local-first tier: the device holds the viewer's partition in IndexedDB,
// reads run locally, writes queue durably. `snapback4 dev` serves
// snapback/schema.q at 127.0.0.1:4400; the persona comes from the URL
// (?as=bob), default alice.
const persona = new URLSearchParams(location.search).get("as") ?? "alice";
const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400";

export function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live: Client | null = null;
    createLocalClient({ url, persona }).then((c) => { live = c; setClient(c); }, (e: Error) => setProblem(e.message));
    return () => { void live?.close(); };
  }, []);
  if (problem) return <p role="alert">Cannot reach {url}: {problem}. Run <code>snapback4 dev</code> in the app directory.</p>;
  if (!client) return <p>Opening your replica…</p>;
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
    <small className="note">as {persona} · {url} · local-first</small>
  </header>;
}
