import { useState } from "react";
import { AppProvider, useAuth, useAppReady } from "snapback4/react";
import { app } from "./client.ts";

export function App() {
  return <AppProvider app={app}><Account /></AppProvider>;
}

// Every read and write runs as the signed-in viewer, so sign in first.
function Account() {
  const auth = useAuth();
  const ready = useAppReady();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in" && !ready) return <p>Opening…</p>;
  if (auth.state === "signed-in") return <Todos />;
  const signIn = async () => {
    const result = await auth.guest();
    if (!result.ok) setProblem(result.why.message);
  };
  return <main>
    <h1>Sign in</h1>
    <p>{problem || auth.why?.message || "Signed out"}</p>
    <button onClick={() => void signIn()}>Continue as a guest</button>
  </main>;
}
