import { presence } from "snapback4/contract";
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
  const member = presence(useQuery(api.myMembership, { conversationId }));
  // These memberships have no horizon and share the messages' group/audience.
  // First acquisition is loading, never denial; the route keeps owning its draft.
  return <>
    <h2>{"data" in room && room.presence === "present" ? room.data.conversation?.title ?? "Conversation" : "Conversation"}</h2>
    {presence(room) === "loading" && <p role="status">Checking this room…</p>}
    {presence(room) === "partial" && <p role="status">Some room information is not available on this device.</p>}
    {"denied" in room && <p role="alert">{room.denied.message}</p>}
    <Thread conversationId={conversationId} />
    <Composer conversationId={conversationId} view={view} canCompose={member !== "absent" && member !== "denied"} />
  </>;
}
