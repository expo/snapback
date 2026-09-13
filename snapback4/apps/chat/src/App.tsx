import { useEffect, useState } from "react";
import { createLocalClient, type LocalClient } from "snapback4/local";
import { webDevice } from "snapback4/web";
import { SnapbackProvider, useClient, useLink, useViewer } from "snapback4/react";
import { Inbox } from "./Inbox.tsx";
import { Thread } from "./Thread.tsx";

// The local-first tier: the device is the Rust module as wasm, holding the
// viewer's partition in memory and keeping it in IndexedDB behind each
// call; reads run locally, writes queue durably. `snapback4 dev` serves
// snapback/schema.q at 127.0.0.1:4400. A persona in the URL (?as=bob) is
// the development door; without one the client keeps a guest session of
// its own across reloads.
const persona = new URLSearchParams(location.search).get("as");
const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400";

export function App() {
  const [client, setClient] = useState<LocalClient | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live: LocalClient | null = null;
    let disposed = false;
    createLocalClient({ url, device: webDevice(), ...(persona ? { persona } : { guest: true }) }).then((c) => {
      if (disposed) { void c.close(); return; }
      live = c;
      setClient(c);
    }, (e: Error) => { if (!disposed) setProblem(e.message); });
    return () => { disposed = true; void live?.close(); };
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
  const viewer = useViewer();
  const client = useClient() as LocalClient;
  return <header>
    <strong>Snapback 4 chat</strong>
    <span role="status">{link === "online" ? "Online" : link === "offline" ? "Offline" : "Signed out"}</span>
    <small className="note">as {viewer ?? "nobody"} · {url} · local-first</small>
    {persona ? null : <button type="button" onClick={() => { void client.signOut().then(() => location.reload()); }}>Sign out</button>}
  </header>;
}
