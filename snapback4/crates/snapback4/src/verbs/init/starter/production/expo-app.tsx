import { useEffect, useState } from "react";
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { AppProvider, useAppReady, useAuth, useMutation, usePage, usePersonaApp, useQuery, useRelease, useSignedInViewer } from "snapback4/react";
import { isFailed, matchRead, matchReadList, type ArgsOf, type Principal } from "snapback4/contract";
import { api } from "./snapback/generated/api";
import { app, openApp, personas, url } from "./src/client";

type TeamId = ArgsOf<typeof api.roster>["teamId"];

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
  return <SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
    <Button title="Password or guest account" onPress={() => setPersona(null)} />
    {development && personas.map(name => <Button key={name} title={`Dev: ${name}`} onPress={() => setPersona(name)} />)}
    {persona && !personaApp ? <Text>Opening persona…</Text> : <AppProvider app={personaApp ?? app}><Account /></AppProvider>}
  </ScrollView></SafeAreaView>;
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
  if (auth.state === "restoring") return <Text>Restoring session…</Text>;
  if (auth.state === "signed-in") return ready ? <Workspace /> : <Text>{auth.why?.message ?? "Opening…"}</Text>;
  return <View style={{ gap: 12 }}><Text>Sign in</Text>
    <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
    <TextInput accessibilityLabel="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
    <Button title="Sign in" disabled={busy} onPress={() => void signIn("login")} />
    <Button title="Sign up" disabled={busy} onPress={() => void signIn("signup")} />
    <Button title="Continue as a guest" disabled={busy} onPress={() => void signIn("guest")} />
    <Text accessibilityRole="alert">{problem || auth.why?.message}</Text>
  </View>;
}

function Workspace() {
  const auth = useAuth(), viewer = useSignedInViewer(), release = useRelease();
  // Drafts and selections belong here, ABOVE every release-dependent query.
  // Only the gated children may unmount when the catalog changes.
  const [title, setTitle] = useState(""), [teamId, setTeamId] = useState<TeamId | null>(null);
  const [principal, setPrincipal] = useState(""), [role, setRole] = useState<"member" | "admin">("member");
  const [selectedPrincipal, setSelectedPrincipal] = useState<Principal | null>(null);
  const create = useMutation(api.createTeam), invite = useMutation(api.invite);
  const failed = [create.last, invite.last].find(isFailed);
  const available = api.myTeams.available(release) && api.myRole.available(release) && api.roster.available(release);
  return <View style={{ gap: 12 }}><Text>Teams and roles</Text><Text selectable>Your principal: {viewer}</Text>
    <Text>Share your principal with an administrator to receive an invitation.</Text>
    <Button title="Sign out" onPress={() => void auth.logout()} />
    <TextInput accessibilityLabel="Team name" value={title} maxLength={80} onChangeText={setTitle} />
    <Button title="Create team" disabled={!title.trim() || !api.createTeam.available(release)} onPress={() => void create.run({ title: title.trim() })} />
    {failed && <Text accessibilityRole="alert">{failed.why.message}</Text>}
    {available ? <>
      <Teams selected={teamId} choose={setTeamId} />
      {teamId && <Team key={teamId} teamId={teamId} principal={principal} setPrincipal={setPrincipal} role={role} setRole={setRole}
        selectedPrincipal={selectedPrincipal} selectPrincipal={setSelectedPrincipal} invite={() => void invite.run({ teamId, principal: principal.trim() as Principal, role })} inviteAvailable={api.invite.available(release)} />}
    </> : <Text>{"denied" in release ? "Not available" : "generation" in release ? "Not available on this release. Your drafts are kept." : "Checking release…"}</Text>}
  </View>;
}

function Teams({ selected, choose }: { selected: TeamId | null; choose: (id: TeamId) => void }) {
  const teams = usePage(api.myTeams, {});
  return matchReadList(teams, {
    otherwise: () => <Text>Teams unavailable; reconnect.</Text>,
    loading: () => <Text>Loading teams…</Text>, denied: why => <Text>Not available: {why.message}</Text>,
    absent: () => <Text>No teams yet. Create one or ask for an invitation.</Text>,
    present: rows => <View style={{ gap: 8 }}><Text>Your teams</Text>{rows.map(row => <Button key={row.id} title={`${selected === row.teamId ? "Selected: " : ""}${row.teamId} · ${row.role}`} onPress={() => choose(row.teamId)} />)}{teams.hasMore && <Button title="More teams" onPress={teams.loadMore} />}</View>,
    partial: rows => <Text>Team list incomplete ({rows.length} known); reconnect.</Text>,
  });
}

function Team(props: { teamId: TeamId; principal: string; setPrincipal: (value: string) => void; role: "member" | "admin"; setRole: (value: "member" | "admin") => void; selectedPrincipal: Principal | null; selectPrincipal: (value: Principal) => void; invite: () => void; inviteAvailable: boolean }) {
  const membership = useQuery(api.myRole, { teamId: props.teamId });
  return matchRead(membership, {
    loading: () => <Text>Loading role…</Text>, denied: why => <Text>Not available: {why.message}</Text>, absent: () => <Text>Not available: no membership.</Text>,
    partial: () => <Text>Role unavailable offline; reconnect.</Text>,
    present: member => <View style={{ gap: 12 }}><Text>Your role: {member.role}</Text>
      <Roster teamId={props.teamId} selected={props.selectedPrincipal} choose={props.selectPrincipal} />
      {member.role === "admin" && <View style={{ gap: 8 }}><Text>Invite by principal</Text>
        <TextInput accessibilityLabel="Principal" autoCapitalize="none" value={props.principal} onChangeText={props.setPrincipal} />
        <Text>Invitation role: {props.role}</Text>
        <Button title="Member role" onPress={() => props.setRole("member")} /><Button title="Admin role" onPress={() => props.setRole("admin")} />
        <Button title="Invite" disabled={!props.principal.trim() || !props.inviteAvailable} onPress={props.invite} />
      </View>}
    </View>,
  });
}

function Roster({ teamId, selected, choose }: { teamId: TeamId; selected: Principal | null; choose: (value: Principal) => void }) {
  const roster = usePage(api.roster, { teamId });
  return matchReadList(roster, {
    otherwise: () => <Text>Roster unavailable; reconnect.</Text>,
    loading: () => <Text>Loading roster…</Text>, denied: why => <Text>Not available: {why.message}</Text>, absent: () => <Text>No members.</Text>,
    present: rows => <View style={{ gap: 8 }}><Text>Choose a member principal</Text>
      {rows.map(row => <Button key={row.id} title={`${selected === row.principal ? "Selected: " : ""}${row.principal} · ${row.role}`} onPress={() => choose(row.principal as Principal)} />)}
      {selected && <Text selectable>Selected principal: {selected}</Text>}{roster.hasMore && <Button title="More members" onPress={roster.loadMore} />}
    </View>,
    partial: rows => <Text>Roster incomplete ({rows.length} known); reconnect.</Text>,
  });
}
