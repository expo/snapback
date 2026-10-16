import { useState, type ReactNode } from "react";
import { AppProvider, useAuth, useAppReady, usePersonaApp } from "snapback4/react";
import { openApp, personas } from "./client.ts";

// `?as=bob` acts as the declared persona dev:bob; the picker switches it.
export function App() {
  const [persona, setPersona] = useState(() => new URLSearchParams(location.search).get("as"));
  // One app and write store per persona: opened on choice, closed on switch and unmount.
  const app = usePersonaApp(persona, openApp);
  const choose = (next: string | null) => {
    const address = new URL(location.href);
    if (next) address.searchParams.set("as", next); else address.searchParams.delete("as");
    history.replaceState(null, "", address);
    setPersona(next);
  };
  if (!persona) return <main>
    <h1>Act as</h1>
    {personas.map(name => <button key={name} onClick={() => choose(name)}>{name}</button>)}
  </main>;
  if (!app) return <p>Opening…</p>;
  return <AppProvider app={app}><Account leave={() => choose(null)}><Todos /></Account></AppProvider>;
}

// Every read and write runs as the persona; there is no session to restore.
function Account({ leave, children }: { leave: () => void; children: ReactNode }) {
  const auth = useAuth();
  const ready = useAppReady();
  if (auth.state === "signed-in" && !ready) return <p>{auth.why?.message ?? "Opening…"}</p>;
  if (auth.state === "signed-in") return children;
  return <main>
    <p>{auth.state === "restoring" ? "Opening…" : auth.why?.message ?? "Signed out"}</p>
    <button onClick={leave}>Choose a persona</button>
  </main>;
}
