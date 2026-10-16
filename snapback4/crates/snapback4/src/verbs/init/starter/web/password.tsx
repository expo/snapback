import { useState } from "react";
import { AppProvider, useAuth, useAppReady } from "snapback4/react";
import { app } from "./client.ts";

export function App() { return <AppProvider app={app}><Account /></AppProvider>; }
function Account() {
  const auth = useAuth();
  const ready = useAppReady();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in" && !ready) return <p>Opening…</p>;
  if (auth.state === "signed-in") return <Todos />;
  async function submit(signup: boolean) {
    setBusy(true); setProblem("");
    try { const result = await (signup ? auth.signup(email, password) : auth.login(email, password)); if (!result.ok) setProblem(result.why.message); }
    catch { setProblem("Sign-in failed; retry."); } finally { setBusy(false); }
  }
  return <main><h1>Sign in</h1><form onSubmit={event => { event.preventDefault(); void submit(false); }}>
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    <button disabled={busy} type="submit">Sign in</button><button disabled={busy} type="button" onClick={() => void submit(true)}>Sign up</button>
    <p role="alert">{problem || auth.why?.message}</p>
  </form></main>;
}
