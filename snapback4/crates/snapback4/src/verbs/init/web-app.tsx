import { useEffect, useMemo, useState } from "react";
import { AppProvider, useAuth, useClient, useAcquired, useLink, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { app, url } from "./client.ts";
import { Inbox } from "./Inbox.tsx";
import { Thread } from "./Thread.tsx";
import { Composer } from "./Composer.tsx";
import { ViewState, routeFromUrl, setRoute } from "./state.ts";

export function App() { return <AppProvider app={app}><Account /></AppProvider>; }
function Account() {
  const auth = useAuth();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <p>Restoring your account…</p>;
  if (auth.state === "signed-in") return <SignedIn />;
  return <section><h1>{auth.why ? "Account needs attention" : "Signed out"}</h1><p>{problem || auth.why?.message}</p>
    <button onClick={() => { void auth.guest().then(result => { if (!result.ok) setProblem(result.why.message); }); }}>Continue as a guest</button>
  </section>;
}
function SignedIn() {
  const client = useClient();
  const view = useMemo(() => new ViewState(client, url, client.viewer()!), [client]);
  useEffect(() => { view.active = true; return () => { view.active = false; }; }, [view]);
  return <Home view={view} />;
}

function Home({ view }: { view: ViewState }) {
  const [selected, setSelected] = useState(() => routeFromUrl() ?? view.read().route);
  const [problem, setProblem] = useState<string>();
  const link = useLink();
  const acquired = useAcquired();
  const auth = useAuth();
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
      <button type="button" onClick={() => { view.active = false; void auth.logout(); }}>Sign out</button>
    </header>
      {problem && <p role="alert">{problem}</p>}
      {selected ? <Room key={selected} conversationId={selected} view={view} /> : <p>Pick a conversation.</p>}
    </main>
  </>;
}

function Room({ conversationId, view }: { conversationId: string; view: ViewState }) {
  const room = useQuery(api.room, { conversationId });
  const link = useLink();
  // A direct held lookup opens a room even when it is beyond the inbox page.
  // No create mutation or global sync barrier belongs on this navigation path.
  const held = "data" in room && room.data.conversation && room.data.membership;
  let content;
  if ("data" in room && room.data.conversation && room.data.membership) content = <>
    <h2>{room.data.conversation.title}</h2>
    {!room.complete && <p>Some room information is not available on this device.</p>}
    <Thread conversationId={conversationId} />
  </>;
  else if (link === "offline" || ("data" in room && !room.complete)) content = <p role="status">This room is not available on this device. Reconnect to check; it may still exist.</p>;
  else if ("loading" in room) content = <p role="status">Checking this room…</p>;
  else content = <p role="alert">{"denied" in room ? room.denied.message : "No accessible room was found in the current read."}</p>;
  // Receipts remain visible even if this room's membership is revoked.
  return <>{content}<Composer conversationId={conversationId} view={view} canCompose={!!held || "loading" in room} /></>;
}
