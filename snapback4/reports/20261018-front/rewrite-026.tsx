import { useState } from "react";
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useAuth, useAppReady, useSignedInViewer, useQueryResult, useMutation } from "snapback4/react";
import { useNativeSmokeGuest } from "./src/native-smoke";
import { app } from "./src/client";
import { api } from "./snapback/generated/api";
import type { Rows } from "./snapback/generated/api";

export function App() { return <AppProvider app={app}><SafeAreaView style={{ flex: 1 }}><StatusBar style="auto" /><Account /></SafeAreaView></AppProvider>; }

function Account() {
  useNativeSmokeGuest();
  const auth = useAuth();
  const ready = useAppReady();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  if (auth.state === "restoring") return <Text>Restoring your session…</Text>;
  if (auth.state === "signed-in" && !ready) return <Text>{auth.why?.message ?? "Opening…"}</Text>;
  if (auth.state === "signed-in") return <Home />;
  async function submit(signup: boolean) {
    setBusy(true); setProblem("");
    try { const result = await (signup ? auth.signup(email, password) : auth.login(email, password)); if (!result.ok) setProblem(result.why.message); }
    catch { setProblem("Sign-in failed; retry."); } finally { setBusy(false); }
  }
  return <View style={{ padding: 24, gap: 12 }}><Text style={{ fontSize: 24 }}>Dorm Noise Reports</Text>
    <Text>Sign in with your hall account.</Text>
    <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
    <TextInput accessibilityLabel="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
    <Button title="Sign in" disabled={busy} onPress={() => void submit(false)} /><Button title="Sign up" disabled={busy} onPress={() => void submit(true)} />
    <Text accessibilityRole="alert">{problem || auth.why?.message}</Text>
  </View>;
}

function Home() {
  const auth = useAuth();
  const viewer = useSignedInViewer();
  const role = useQueryResult(api.myRole, {});
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 20 }}>Dorm Noise Reports</Text>
    <Text>Signed in as {viewer}</Text>
    {role.why ? <Text accessibilityRole="alert">{role.why.message}</Text> : role.data === undefined ? <Text>Loading your assignment…</Text> : (role.data ? <RoleScreen role={role.data.role} floor={role.data.floor} room={role.data.room} /> : <PendingAssignment />)}
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </ScrollView>;
}

function RoleScreen(props: { role: Rows["roster"]["role"]; floor: number | null; room: string | null }) {
  if (props.role === "resident") return <ResidentHome room={props.room} />;
  if (props.role === "ra") return <RaHome floor={props.floor} />;
  return <DirectorHome />;
}

function PendingAssignment() {
  return <Text>Account created. Ask the hall director to assign your role and room.</Text>;
}

function ResidentHome(props: { room: string | null }) {
  const file = useMutation(api.fileReport);
  const [targetRoom, setTargetRoom] = useState("");
  const [detail, setDetail] = useState("");
  const [message, setMessage] = useState("");
  const reports = useQueryResult(api.myReports, {});
  const warnings = useQueryResult(api.myWarnings, {});
  async function submit() {
    setMessage("");
    const write = await file.run({ targetRoom, detail });
    setMessage(write.state === "failed" ? `Refused: ${write.why.message}` : "Report filed.");
  }
  return <View style={{ gap: 12 }}>
    <Text style={{ fontSize: 18 }}>Resident{props.room ? ` · room ${props.room}` : ""}</Text>
    <Text>Reports are accepted between 10 pm and 8 am UTC. Your name is never shown to the reported room.</Text>
    <TextInput accessibilityLabel="Room" placeholder="Noisy room, e.g. 102" value={targetRoom} onChangeText={setTargetRoom} />
    <TextInput accessibilityLabel="Details" placeholder="What is happening?" value={detail} onChangeText={setDetail} />
    <Button title="File report" onPress={() => void submit()} />
    <Text accessibilityLiveRegion="polite">{message || (file.inFlight ? "Sending…" : "")}</Text>
    <Text style={{ fontSize: 18 }}>My reports</Text>
    <View testID="my-reports">
      {reports.why ? <Text accessibilityRole="alert">{reports.why.message}</Text> : reports.data === undefined ? <Text>Loading reports…</Text> : (reports.data.length ? <>{reports.data.map(r => <Text key={r.id}>{r.room} · {r.status}{r.warning ? ` · warning: ${r.warning}` : ""} · {r.detail}</Text>)}</> : <Text>No reports yet.</Text>)}
    </View>
    <Text style={{ fontSize: 18 }}>Warnings for my room</Text>
    <View testID="my-warnings">
      {warnings.why ? <Text accessibilityRole="alert">{warnings.why.message}</Text> : warnings.data === undefined ? <Text>Loading warnings…</Text> : (warnings.data.length ? <>{warnings.data.map(w => <Text key={w.id}>{w.room} · {w.text}</Text>)}</> : <Text>No warnings.</Text>)}
    </View>
  </View>;
}

function RaHome(props: { floor: number | null }) {
  const floor = props.floor ?? 1;
  const reports = useQueryResult(api.floorReports, { floor });
  const warnings = useQueryResult(api.floorWarnings, { floor });
  return <View style={{ gap: 12 }}>
    <Text style={{ fontSize: 18 }}>Resident adviser · floor {floor}</Text>
    <Text>New reports for your floor appear here live. Reporters stay anonymous.</Text>
    <View testID="floor-reports">
      {reports.why ? <Text accessibilityRole="alert">{reports.why.message}</Text> : reports.data === undefined ? <Text>Loading floor reports…</Text> : (reports.data.length ? <>{reports.data.map(r => <Text key={r.id}>{r.room} · {r.status} · {r.detail}</Text>)}</> : <Text>No reports on this floor.</Text>)}
    </View>
    <Text style={{ fontSize: 18 }}>Warnings on this floor</Text>
    <View testID="floor-warnings">
      {warnings.why ? <Text accessibilityRole="alert">{warnings.why.message}</Text> : warnings.data === undefined ? <Text>Loading warnings…</Text> : (warnings.data.length ? <>{warnings.data.map(w => <Text key={w.id}>{w.room} · {w.text}</Text>)}</> : <Text>No warnings.</Text>)}
    </View>
  </View>;
}

function DirectorHome() {
  const warn = useMutation(api.issueWarning);
  const [reportId, setReportId] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const escalated = useQueryResult(api.escalatedReports, {});
  const floor1 = useQueryResult(api.floorReports, { floor: 1 });
  const floor2 = useQueryResult(api.floorReports, { floor: 2 });
  async function submit() {
    setMessage("");
    const write = await warn.run({ report: reportId.trim(), text });
    setMessage(write.state === "failed" ? `Refused: ${write.why.message}` : "Warning issued.");
  }
  const renderReports = (rows: Rows["reports"][]) => rows.length
    ? <>{rows.map(r => <Text key={r.id}>{r.id} · {r.room} · {r.status} · {r.detail}</Text>)}</>
    : <Text>None.</Text>;
  return <View style={{ gap: 12 }}>
    <Text style={{ fontSize: 18 }}>Hall director</Text>
    <Text style={{ fontSize: 18 }}>Escalated rooms (3+ reports in a week)</Text>
    <View testID="escalated-reports">
      {escalated.why ? <Text accessibilityRole="alert">{escalated.why.message}</Text> : escalated.data === undefined ? <Text>Loading…</Text> : renderReports(escalated.data)}
    </View>
    <Text>Issue a formal warning on a report. The warned room sees it.</Text>
    <TextInput accessibilityLabel="Report ID" placeholder="Report ID" value={reportId} onChangeText={setReportId} autoCapitalize="none" />
    <TextInput accessibilityLabel="Warning text" placeholder="Warning text" value={text} onChangeText={setText} />
    <Button title="Issue warning" onPress={() => void submit()} />
    <Text accessibilityLiveRegion="polite">{message || (warn.inFlight ? "Sending…" : "")}</Text>
    <Text style={{ fontSize: 18 }}>Floor 1 reports</Text>
    <View testID="floor1-reports">{floor1.why ? <Text accessibilityRole="alert">{floor1.why.message}</Text> : floor1.data === undefined ? <Text>Loading…</Text> : renderReports(floor1.data)}</View>
    <Text style={{ fontSize: 18 }}>Floor 2 reports</Text>
    <View testID="floor2-reports">{floor2.why ? <Text accessibilityRole="alert">{floor2.why.message}</Text> : floor2.data === undefined ? <Text>Loading…</Text> : renderReports(floor2.data)}</View>
  </View>;
}
