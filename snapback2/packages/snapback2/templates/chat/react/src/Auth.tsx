import { Fragment, useState, type ReactNode } from "react";
import { useAuth } from "snapback2/react";

export function Auth({ children }: { children: ReactNode }) {
  const { session, actions } = useAuth();
  const viewer = session.viewer ?? session.restoringViewer;
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); setPassword(""); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <><section aria-label="Account">
    {viewer ? <><p>{session.state === "authenticated" ? "Signed in as" : "Restoring"} {viewer} ({session.kind ?? "account"})</p><button disabled={busy || session.state !== "authenticated"} onClick={() => void run(actions.refresh)}>Renew session</button><button disabled={busy} onClick={() => void run(actions.logout)}>Log out</button></> :
      <form onSubmit={event => { event.preventDefault(); void run(() => actions.login({ email, password })); }}>
        <h1>Welcome</h1><label>Email <input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
        <label>Password <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <button disabled={busy}>Log in</button><button type="button" disabled={busy || !email || !password} onClick={() => void run(() => actions.signup({ email, password }))}>Sign up</button>
        <button type="button" disabled={busy} onClick={() => void run(actions.guest)}>Continue as guest</button>
      </form>}
    {session.state === "hydrating" ? <p role="status">Restoring session…</p> : null}
    {error || session.refusal ? <p role="alert">{error || session.refusal?.message}</p> : null}
  </section>{viewer ? <Fragment key={viewer}>{children}</Fragment> : null}</>;
}
