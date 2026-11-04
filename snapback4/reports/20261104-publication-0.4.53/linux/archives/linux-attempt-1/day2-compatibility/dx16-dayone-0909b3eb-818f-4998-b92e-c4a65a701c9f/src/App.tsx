import { useState } from "react";
import { AppProvider, useAuth, useAppReady, useLink, useSignedInViewer, matchRead, otherwiseAll, readPresentation, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { app } from "./client.ts";

export function App() { return <AppProvider app={app}><Account /></AppProvider>; }
function Account() {
  const auth = useAuth();
  const ready = useAppReady();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in" && !ready) return <p>{auth.why?.message ?? "Opening…"}</p>;
  if (auth.state === "signed-in") return <Home />;
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

// Your first screen: replace it with your own. `snapback4 check` writes
// snapback/generated/api.ts, a typed handle for each operation in
// snapback/*.q. Read with useQuery(api.yourQuery, args) and render the Read
// with matchRead, or usePage(api.yourList, args) for a query that takes
// `c: cursor ?`; write with useMutation(api.yourMutation). Name hook results
// in props as UseQuery<typeof api.op>, UsePage<…> and UseMutation<…>
// (`npx snapback4 guide client`).
function Home() {
  const auth = useAuth(), link = useLink();
  // Never null here: Account renders this screen only once signed in.
  const viewer = useSignedInViewer();
  return <main>
    <header>
      <h1>Signed in</h1>
      <span role="status">{viewer} · {link === "online" ? "Online" : "Offline"}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    <p>Your operations, from snapback/generated/api.ts: {Object.keys(api).join(", ") || "none yet"}</p>
    <FirstRead />
  </main>;
}

// Your first read, to replace: api.listDayOne is your first query that takes no
// required arguments. matchRead names the Read's states; `...otherwiseAll`
// renders every state you do not name (loading, partial, denied), and
// readPresentation(read).why is the refusal when there is one. A handler you
// add (`partial: rows => …`, `denied: why => …`) wins wherever you write it.
function FirstRead() {
  const read = useQuery(api.listDayOne, {});
  return <p>api.listDayOne: {matchRead(read, { ...otherwiseAll(other => readPresentation(other).why?.message ?? "…"), present: data => JSON.stringify(data).slice(0, 200), absent: () => "nothing yet" })}</p>;
}
