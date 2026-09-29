import { existence } from "snapback4/contract";
import { useEffect, useState } from "react";
import { createLocalClient, type LocalClient } from "snapback4/local";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
import { SnapbackProvider, useAcquired, useLink, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { Inbox } from "./Inbox.tsx";
import { Thread } from "./Thread.tsx";
import { Composer } from "./Composer.tsx";
import { ViewState, routeFromUrl, setRoute } from "./state.ts";

const url = (import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400").replace(/\/$/, "");
// Explicit browser persistence: page scripts can read the token. See README.
const sessionStore = localStorageSessionStore();
type Open = { client: LocalClient; view: ViewState };

export function App() {
  const [persona, setPersona] = useState(new URLSearchParams(location.search).get("as"));
  const [open, setOpen] = useState<Open | null>(null);
  const [ending, setEnding] = useState(false);
  const [leaving, setLeaving] = useState<{ nextPersona: string | undefined } | null>(null);
  const [stopped, setStopped] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (stopped) return;
    let opened: Open | null = null;
    let disposed = false;
    setProblem(null);
    createLocalClient({ url, device: webDevice(), sessionStore, ...(persona ? { persona } : { guest: true }) }).then(client => {
      if (disposed) { void client.close(); return; }
      opened = { client, view: new ViewState(client, url, client.viewer()!) };
      setOpen(opened);
    }, (error: Error) => { if (!disposed) setProblem(error.message); });
    return () => { disposed = true; if (opened) { opened.view.active = false; void opened.client.close(); } };
  }, [persona, stopped]);
  const leave = (nextPersona?: string) => {
    if (!open || ending) return;
    // Fence callbacks synchronously, before React unmount or network sign-out.
    open.view.active = false;
    setRoute();
    setLeaving({ nextPersona });
    setEnding(true);
    setProblem(null);
    const address = new URL(location.href);
    address.searchParams.delete("as");
    if (nextPersona) address.searchParams.set("as", nextPersona);
    history.replaceState(null, "", address);
    const closing = nextPersona ? open.client.close() : open.client.signOut();
    void closing.then(() => {
      setOpen(null);
      setLeaving(null);
      setEnding(false);
      if (nextPersona) setPersona(nextPersona);
      else setStopped(true);
    }, (error: Error) => { setEnding(false); setProblem(error.message); });
  };
  if (stopped) return <section><h1>Signed out</h1><p>Pending writes remain with their original account; sign-out does not settle them.</p><button onClick={() => { setPersona(null); setStopped(false); }}>Continue as a guest</button></section>;
  if (leaving) return <section><h1>{ending ? (leaving.nextPersona ? "Switching accounts…" : "Signing out…") : "Account could not be closed"}</h1>{problem && <p role="alert">{problem}. Local sign-out has not completed.</p>}<button disabled={ending} onClick={() => leave(leaving.nextPersona)}>Retry</button></section>;
  if (problem) return <p role="alert">Could not open this account: {problem}. A first visit needs the backend; a previously acquired account can reopen offline.</p>;
  if (!open) return <p>Opening your replica…</p>;
  return <SnapbackProvider client={open.client}><Home key={open.view.key} view={open.view} persona={persona} leave={leave} /></SnapbackProvider>;
}

function Home({ view, persona, leave }: { view: ViewState; persona: string | null; leave(next?: string): void }) {
  const [selected, setSelected] = useState(() => routeFromUrl() ?? view.read().route);
  const [problem, setProblem] = useState<string>();
  const link = useLink();
  const acquired = useAcquired();
  useEffect(() => {
    const changed = () => { if (view.current()) setSelected(routeFromUrl() ?? view.read().route); };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [view]);
  const select = (room: string) => {
    if (!view.current()) return;
    try { view.route(room); setRoute(room); setSelected(room); }
    catch (error) { setProblem(String(error)); }
  };
  if (link === "signed-out") return <p>Signed out. Reopen after signing in.</p>;
  return <>
    <Inbox selected={selected} onSelect={select} />
    <main><header>
      <strong>Snapback 4 chat</strong><span role="status">{link === "online" ? "Online" : "Offline"}</span>
      <small className="note">as {view.principal} · {acquired ? "Local data acquired" : "Local data still acquiring"}</small>
      {persona ? <select aria-label="Development account" value={persona} onChange={e => leave(e.target.value)}>{["alice", "bob", "charlie"].map(name => <option key={name}>{name}</option>)}</select> : null}
      <button type="button" onClick={() => leave()}>Sign out</button>
    </header>
      {problem && <p role="alert">{problem}</p>}
      {selected ? <Room key={selected} conversationId={selected} view={view} /> : <p>Pick a conversation.</p>}
    </main>
  </>;
}

function Room({ conversationId, view }: { conversationId: string; view: ViewState }) {
  const room = useQuery(api.room, { conversationId });
  const member = existence(useQuery(api.myMembership, { conversationId }));
  // These memberships have no horizon and share the messages' group/audience.
  // First acquisition is loading, never denial; the route keeps owning its draft.
  return <>
    <h2>{"data" in room && room.existence === "present" ? room.data.conversation?.title ?? "Conversation" : "Conversation"}</h2>
    {existence(room) === "loading" && <p role="status">Checking this room…</p>}
    {existence(room) === "partial" && <p role="status">Some room information is not available on this device.</p>}
    {"denied" in room && <p role="alert">{room.denied.message}</p>}
    <Thread conversationId={conversationId} />
    <Composer conversationId={conversationId} view={view} canCompose={member !== "absent" && member !== "denied"} />
  </>;
}
