import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { App as SnapbackApp } from "snapback4/app";
import { isDenied, isLoading } from "snapback4/contract";
import { AppProvider, useAuth, useLink, useMutation, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { openApp, personas } from "./client.ts";

// `?as=bob` acts as the declared persona dev:bob; the picker switches it.
export function App() {
  const [persona, setPersona] = useState(() => new URLSearchParams(location.search).get("as"));
  const [app, setApp] = useState<SnapbackApp | null>(null);
  useEffect(() => {
    if (!persona) return;
    const opened = openApp(persona);
    setApp(opened);
    return () => { setApp(null); void opened.close(); };
  }, [persona]);
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
  if (auth.state === "signed-in") return children;
  return <main>
    <p>{auth.state === "restoring" ? "Opening…" : auth.why?.message ?? "Signed out"}</p>
    <button onClick={leave}>Choose a persona</button>
  </main>;
}

