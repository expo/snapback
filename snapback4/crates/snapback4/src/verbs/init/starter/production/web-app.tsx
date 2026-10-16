import { useEffect, useState } from "react";
import { AppProvider, useAppReady, useAuth, useMutation, usePage, usePersonaApp, useQuery, useRelease, useSignedInViewer } from "snapback4/react";
import { isFailed, matchRead, matchReadList, type ArgsOf, type Principal } from "snapback4/contract";
import { api } from "../snapback/generated/api.ts";
import { app, openApp, personas, url } from "./client.ts";

type TeamId = ArgsOf<typeof api.roster>["teamId"];

// Separate session and persona clients: switching accounts closes the persona
// device and clears account-owned drafts. Production offers accounts only.
export function App() {
  const [persona, setPersona] = useState<string | null>(null);
  // Even loopback may host serve: only the server's development declaration
  // enables persona controls. Pending, failed and non-development reads hide them.
  const [development, setDevelopment] = useState(false);
  useEffect(() => {
    let current = true;
    void fetch(`${url}/auth/config`, { method: "GET" })
      .then(response => response.ok ? response.json() : null)
      .then(config => { if (current) setDevelopment(config?.development === true); })
      .catch(() => { if (current) setDevelopment(false); });
    return () => { current = false; };
  }, []);
  const personaApp = usePersonaApp(development ? persona : null, openApp);
  return <>
    <nav><button onClick={() => setPersona(null)}>Password or guest account</button>
      {development && personas.map(name => <button key={name} onClick={() => setPersona(name)}>Dev: {name}</button>)}
    </nav>
    {persona && !personaApp ? <p>Opening persona…</p> : <AppProvider app={personaApp ?? app}><Account /></AppProvider>}
  </>;
}

function Account() {
  const auth = useAuth(), ready = useAppReady();
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  async function signIn(kind: "login" | "signup" | "guest") {
    setBusy(true); setProblem("");
    try {
      const result = await (kind === "guest" ? auth.guest() : auth[kind](email, password));
      if (!result.ok) setProblem(result.why.message);
    } catch { setProblem("Sign-in failed; retry."); } finally { setBusy(false); }
  }
  if (auth.state === "restoring") return <p>Restoring session…</p>;
  if (auth.state === "signed-in") return ready ? <Workspace /> : <p>{auth.why?.message ?? "Opening…"}</p>;
  return <main><h1>Sign in</h1>
    <form onSubmit={event => { event.preventDefault(); void signIn("login"); }}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button disabled={busy}>Sign in</button>
      <button type="button" disabled={busy} onClick={() => void signIn("signup")}>Sign up</button>
      <button type="button" disabled={busy} onClick={() => void signIn("guest")}>Continue as a guest</button>
    </form><p role="alert">{problem || auth.why?.message}</p>
  </main>;
}

function Workspace() {
  const auth = useAuth(), viewer = useSignedInViewer(), release = useRelease();
  // All drafts and selections live ABOVE every release-dependent query.
  // Generation changes can remount query children, never this screen.
  const [title, setTitle] = useState(""), [teamId, setTeamId] = useState<TeamId | null>(null);
  const [principal, setPrincipal] = useState(""), [role, setRole] = useState<"member" | "admin">("member");
  const [selectedPrincipal, setSelectedPrincipal] = useState<Principal | null>(null);
  const create = useMutation(api.createTeam), invite = useMutation(api.invite);
  const failed = [create.last, invite.last].find(isFailed);
  const available = api.myTeams.available(release) && api.myRole.available(release) && api.roster.available(release);
  return <main><h1>Teams and roles</h1><p>Your principal: <output>{viewer}</output></p>
    <p>Share your principal with an administrator to receive an invitation.</p>
    <button onClick={() => void auth.logout()}>Sign out</button>
    <label>Team name<input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} /></label>
    <button disabled={!title.trim() || !api.createTeam.available(release)} onClick={() => void create.run({ title: title.trim() })}>Create team</button>
    {failed && <p role="alert">{failed.why.message}</p>}
    {available ? <>
      <Teams selected={teamId} choose={setTeamId} />
      {teamId && <Team key={teamId} teamId={teamId} principal={principal} setPrincipal={setPrincipal} role={role} setRole={setRole}
        selectedPrincipal={selectedPrincipal} selectPrincipal={setSelectedPrincipal} invite={() => void invite.run({ teamId, principal: principal.trim() as Principal, role })} inviteAvailable={api.invite.available(release)} />}
    </> : <p>{"denied" in release ? "Not available" : "generation" in release ? "Not available on this release. Your drafts are kept." : "Checking release…"}</p>}
  </main>;
}

function Teams({ selected, choose }: { selected: TeamId | null; choose: (id: TeamId) => void }) {
  const teams = usePage(api.myTeams, {});
  return matchReadList(teams, {
    otherwise: () => <p>Teams unavailable; reconnect.</p>,
    loading: () => <p>Loading teams…</p>, denied: why => <p>Not available: {why.message}</p>,
    absent: () => <p>No teams yet. Create one or ask for an invitation.</p>,
    present: rows => <><h2>Your teams</h2>{rows.map(row => <button key={row.id} aria-pressed={selected === row.teamId} onClick={() => choose(row.teamId)}>{row.teamId} · {row.role}</button>)}{teams.hasMore && <button onClick={teams.loadMore}>More teams</button>}</>,
    partial: rows => <p>Team list incomplete ({rows.length} known); reconnect.</p>,
  });
}

function Team(props: { teamId: TeamId; principal: string; setPrincipal: (value: string) => void; role: "member" | "admin"; setRole: (value: "member" | "admin") => void; selectedPrincipal: Principal | null; selectPrincipal: (value: Principal) => void; invite: () => void; inviteAvailable: boolean }) {
  const membership = useQuery(api.myRole, { teamId: props.teamId });
  return matchRead(membership, {
    loading: () => <p>Loading role…</p>, denied: why => <p>Not available: {why.message}</p>, absent: () => <p>Not available: no membership.</p>,
    partial: () => <p>Role unavailable offline; reconnect.</p>,
    present: member => <section><h2>Your role: {member.role}</h2>
      <Roster teamId={props.teamId} selected={props.selectedPrincipal} choose={props.selectPrincipal} />
      {member.role === "admin" && <fieldset><legend>Invite by principal</legend>
        <label>Principal<input value={props.principal} onChange={e => props.setPrincipal(e.target.value)} /></label>
        <label>Role<select aria-label="Role" value={props.role} onChange={e => props.setRole(e.target.value as "member" | "admin")}><option value="member">Member</option><option value="admin">Admin</option></select></label>
        <button disabled={!props.principal.trim() || !props.inviteAvailable} onClick={props.invite}>Invite</button>
      </fieldset>}
    </section>,
  });
}

function Roster({ teamId, selected, choose }: { teamId: TeamId; selected: Principal | null; choose: (value: Principal) => void }) {
  const roster = usePage(api.roster, { teamId });
  return matchReadList(roster, {
    otherwise: () => <p>Roster unavailable; reconnect.</p>,
    loading: () => <p>Loading roster…</p>, denied: why => <p>Not available: {why.message}</p>, absent: () => <p>No members.</p>,
    present: rows => <><label>Member principal<select aria-label="Member principal" value={selected ?? ""} onChange={e => choose(e.target.value as Principal)}>
      <option value="" disabled>Choose a principal</option>{rows.map(row => <option key={row.id} value={row.principal}>{row.principal} · {row.role}</option>)}
    </select></label>{selected && <p>Selected principal: {selected}</p>}{roster.hasMore && <button onClick={roster.loadMore}>More members</button>}</>,
    partial: rows => <p>Roster incomplete ({rows.length} known); reconnect.</p>,
  });
}
