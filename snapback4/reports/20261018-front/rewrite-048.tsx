import { useState, type FormEvent } from "react";
import {
  AppProvider, useAuth, useAppReady, useClient, useMutation, usePage, useQueryResult,
  useSignedInViewer, type UseMutation, type UsePage,
} from "snapback4/react";
import { isFailed } from "snapback4/contract";
import { api } from "../snapback/generated/api.ts";
import { app } from "./client.ts";

export function App() {
  return <AppProvider app={app}><Account /></AppProvider>;
}

function Account() {
  const auth = useAuth();
  const ready = useAppReady();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in" && !ready) return <p>{auth.why?.message ?? "Opening…"}</p>;
  if (auth.state === "signed-in") return <RoleGate />;
  const signIn = async (mode: "signup" | "login") => {
    const result = mode === "signup" ? await auth.signup(email, password) : await auth.login(email, password);
    if (!result.ok) setProblem(result.why.message);
    else setProblem("");
  };
  return <main>
    <h1>Boiler Room Rounds</h1>
    <p>{problem || auth.why?.message || "Sign up or log in with your building account."}</p>
    <label>Email<input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
    <label>Password<input aria-label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
    <button onClick={() => void signIn("signup")}>Sign up</button>
    <button onClick={() => void signIn("login")}>Log in</button>
  </main>;
}

function RoleGate() {
  const auth = useAuth();
  const viewer = useSignedInViewer();
  const {data: role, why} = useQueryResult(api.myRole, {});
  return <main>
    <header>
      <h1>Boiler Room Rounds</h1>
      <span role="status">{viewer}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    {why ? <p role="alert">Not available: {why.message}</p> : role === undefined ? <p>Loading your role…</p> : role === null ? <JoinScreen /> : role.role === "engineer" ? <EngineerScreen /> : role.role === "chief" ? <ChiefScreen /> : role.role === "contractor" ? <ContractorScreen /> : <ManagerScreen />}
  </main>;
}

function JoinScreen() {
  const join = useMutation(api.joinAs);
  const failed = isFailed(join.last) ? join.last.why.message : "";
  const pick = (role: "engineer" | "contractor" | "manager") => { void join.run({ role }); };
  return <section aria-label="Choose your role">
    <h2>Choose your role</h2>
    <p>Chief accounts are created by another chief.</p>
    <button onClick={() => pick("engineer")}>Join as engineer</button>
    <button onClick={() => pick("contractor")}>Join as contractor</button>
    <button onClick={() => pick("manager")}>Join as manager</button>
    {failed && <p role="alert">{failed}</p>}
  </section>;
}

function fmtTime(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function FailedBanner({ lasts }: { lasts: unknown[] }) {
  const failed = lasts.find(isFailed);
  if (!failed) return null;
  return <p role="alert">{failed.why.message}</p>;
}

function EngineerScreen() {
  const shifts = usePage(api.myShifts, {});
  const [shiftId, setShiftId] = useState<string>("");
  const current = shiftId || (shifts.items.length > 0 && shifts.items[0] ? shifts.items[0].id : "");
  return <section aria-label="Engineer workspace">
    <h2>Engineer rounds</h2>
    {"denied" in shifts.read
      ? <p role="alert">Not available: {shifts.read.denied.message}</p>
      : <>
        <label htmlFor="shift">Shift</label>
        <select id="shift" value={current} onChange={e => setShiftId(e.target.value)}>
          {shifts.items.map(s => <option key={s.id} value={s.id}>{s.label} ({fmtTime(s.startsAt)} – {fmtTime(s.endsAt)})</option>)}
        </select>
        {current ? <RoundsList shift={current} /> : <p>No shifts assigned.</p>}
      </>}
    <GaugeHistory />
  </section>;
}

function RoundsList({ shift, canWrite = true }: { shift: string; canWrite?: boolean }) {
  const rounds = usePage(api.shiftRounds, { shift });
  const [roundId, setRoundId] = useState<string>("");
  return <div>
    <h3>Rounds</h3>
    {"denied" in rounds.read
      ? <p role="alert">Not available: {rounds.read.denied.message}</p>
      : <ul>
        {rounds.items.map(r => <li key={r.id}>
          <button onClick={() => setRoundId(r.id)} aria-label={`Open round ${fmtTime(r.scheduledAt)}`}>
            {fmtTime(r.scheduledAt)} — {r.status}
          </button>
        </li>)}
      </ul>}
    {rounds.hasMore && <button onClick={rounds.loadMore}>Show more</button>}
    {roundId && <RoundDetail roundId={roundId} canWrite={canWrite} onClose={() => setRoundId("")} />}
  </div>;
}

function RoundDetail({ roundId, canWrite, onClose }: { roundId: string; canWrite: boolean; onClose: () => void }) {
  const readings = usePage(api.roundReadings, { roundId });
  const complete = useMutation(api.completeRound);
  const submit = async () => { await complete.run({ roundId }); };
  return <div>
    <h4>Round readings</h4>
    <button onClick={onClose}>Close</button>
    {"denied" in readings.read
      ? <p role="alert">Not available: {readings.read.denied.message}</p>
      : <ul>
        {readings.items.map(r => <li key={r.id}>
          gauge {r.gauge}: {r.pressure} kPa, {r.temp} °C at {fmtTime(r.loggedAt)}
        </li>)}
      </ul>}
    {readings.hasMore && <button onClick={readings.loadMore}>Show more</button>}
    {canWrite && <LogReadingForm roundId={roundId} />}
    {canWrite && <button onClick={() => void submit()}>Complete round</button>}
    <FailedBanner lasts={[complete.last]} />
  </div>;
}

function LogReadingForm({ roundId }: { roundId: string }) {
  const client = useClient();
  const gauges = usePage(api.gaugesList, {});
  const log = useMutation(api.logReading);
  const [gaugeId, setGaugeId] = useState("");
  const [pressure, setPressure] = useState("500");
  const [temp, setTemp] = useState("85");
  const [assetId, setAssetId] = useState("");
  const [uploadState, setUploadState] = useState("No photo yet.");
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploadState("Uploading…");
    const uploaded = await client.upload(file);
    if (!uploaded.ok) { setUploadState(`Upload failed: ${uploaded.why.message}`); return; }
    setAssetId(uploaded.asset.id);
    setUploadState("Photo ready.");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!gaugeId || !assetId) { setUploadState("Pick a gauge and a gauge photo first."); return; }
    void log.run({ roundId, gaugeId, pressure: Number(pressure), temp: Number(temp), photo: { id: assetId } });
  };
  return <form onSubmit={submit} aria-label="Log a reading">
    <h4>Log a reading</h4>
    <label htmlFor="gauge">Gauge</label>
    <select id="gauge" value={gaugeId} onChange={e => setGaugeId(e.target.value)}>
      <option value="">Choose a gauge</option>
      {gauges.items.map(g => <option key={g.id} value={g.id}>{g.name} ({g.location})</option>)}
    </select>
    <label>Pressure (kPa)<input aria-label="Pressure" inputMode="numeric" value={pressure} onChange={e => setPressure(e.target.value)} /></label>
    <label>Temperature (°C)<input aria-label="Temperature" inputMode="numeric" value={temp} onChange={e => setTemp(e.target.value)} /></label>
    <label>Gauge photo<input aria-label="Gauge photo" type="file" accept="image/*" onChange={e => void pickPhoto(e.target.files?.[0])} /></label>
    <p role="status">{uploadState}</p>
    <button type="submit">Save reading</button>
    <FailedBanner lasts={[log.last]} />
  </form>;
}

function GaugeHistory() {
  const gauges = usePage(api.gaugesList, {});
  const [gaugeId, setGaugeId] = useState("");
  return <div>
    <h3>Live gauge history</h3>
    <label htmlFor="history-gauge">Gauge</label>
    <select id="history-gauge" value={gaugeId} onChange={e => setGaugeId(e.target.value)}>
      <option value="">Choose a gauge</option>
      {gauges.items.map(g => <option key={g.id} value={g.id}>{g.name} ({g.location})</option>)}
    </select>
    {gaugeId && <HistoryList gaugeId={gaugeId} />}
  </div>;
}

function HistoryList({ gaugeId }: { gaugeId: string }) {
  const history = usePage(api.gaugeHistory, { gaugeId });
  return <div>
    {"denied" in history.read
      ? <p role="alert">Not available: {history.read.denied.message}</p>
      : <ul>
        {history.items.map(r => <li key={r.id}>
          {r.pressure} kPa, {r.temp} °C at {fmtTime(r.loggedAt)}
        </li>)}
      </ul>}
    {history.hasMore && <button onClick={history.loadMore}>Show more</button>}
  </div>;
}

function localInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

function ChiefScreen() {
  return <section aria-label="Chief workspace">
    <h2>Chief engineer</h2>
    <AlertsInbox />
    <GaugesManager />
    <ShiftsManager />
    <RosterManager />
  </section>;
}

function AlertsInbox() {
  const alerts = usePage(api.alertsInbox, {});
  const ack = useMutation(api.acknowledgeAlert);
  return <div>
    <h3>Alerts</h3>
    {"denied" in alerts.read
      ? <p role="alert">Not available: {alerts.read.denied.message}</p>
      : <ul>
        {alerts.items.map(a => <li key={a.id}>
          [{a.kind}] round {a.round}{a.gauge ? ` gauge ${a.gauge}` : ""}: {a.message} at {fmtTime(a.at)}
          {a.acknowledged ? " (acknowledged)" : <button onClick={() => void ack.run({ alertId: a.id })} aria-label={`Acknowledge alert ${a.id}`}>Acknowledge</button>}
        </li>)}
      </ul>}
    {alerts.hasMore && <button onClick={alerts.loadMore}>Show more</button>}
    <FailedBanner lasts={[ack.last]} />
  </div>;
}

function GaugesManager() {
  const gauges = usePage(api.gaugesList, {});
  const add = useMutation(api.addGauge);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [minP, setMinP] = useState("300");
  const [maxP, setMaxP] = useState("800");
  const [minT, setMinT] = useState("60");
  const [maxT, setMaxT] = useState("120");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !location.trim()) return;
    void add.run({ name: name.trim(), location: location.trim(), minPressure: Number(minP), maxPressure: Number(maxP), minTemp: Number(minT), maxTemp: Number(maxT) });
  };
  return <div>
    <h3>Gauges</h3>
    <form onSubmit={submit} aria-label="Add a gauge">
      <label>Gauge name<input aria-label="Gauge name" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
      <label>Location<input aria-label="Gauge location" value={location} onChange={e => setLocation(e.target.value)} maxLength={120} /></label>
      <label>Min pressure<input aria-label="Min pressure" inputMode="numeric" value={minP} onChange={e => setMinP(e.target.value)} /></label>
      <label>Max pressure<input aria-label="Max pressure" inputMode="numeric" value={maxP} onChange={e => setMaxP(e.target.value)} /></label>
      <label>Min temp<input aria-label="Min temp" inputMode="numeric" value={minT} onChange={e => setMinT(e.target.value)} /></label>
      <label>Max temp<input aria-label="Max temp" inputMode="numeric" value={maxT} onChange={e => setMaxT(e.target.value)} /></label>
      <button type="submit">Add gauge</button>
    </form>
    {"denied" in gauges.read
      ? <p role="alert">Not available: {gauges.read.denied.message}</p>
      : <ul>
        {gauges.items.map(g => <li key={g.id}>
          {g.name} ({g.location}): {g.minPressure}–{g.maxPressure} kPa, {g.minTemp}–{g.maxTemp} °C
          <SetLimitsForm gaugeId={g.id} />
          <ContractorAssignment gaugeId={g.id} />
        </li>)}
      </ul>}
    {gauges.hasMore && <button onClick={gauges.loadMore}>Show more</button>}
    <FailedBanner lasts={[add.last]} />
  </div>;
}

function SetLimitsForm({ gaugeId }: { gaugeId: string }) {
  const set = useMutation(api.setLimits);
  const [minP, setMinP] = useState("300");
  const [maxP, setMaxP] = useState("800");
  const [minT, setMinT] = useState("60");
  const [maxT, setMaxT] = useState("120");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void set.run({ gaugeId, minPressure: Number(minP), maxPressure: Number(maxP), minTemp: Number(minT), maxTemp: Number(maxT) });
  };
  return <form onSubmit={submit} aria-label={`Limits for ${gaugeId}`}>
    <label>Min P<input aria-label={`Min P ${gaugeId}`} inputMode="numeric" value={minP} onChange={e => setMinP(e.target.value)} /></label>
    <label>Max P<input aria-label={`Max P ${gaugeId}`} inputMode="numeric" value={maxP} onChange={e => setMaxP(e.target.value)} /></label>
    <label>Min T<input aria-label={`Min T ${gaugeId}`} inputMode="numeric" value={minT} onChange={e => setMinT(e.target.value)} /></label>
    <label>Max T<input aria-label={`Max T ${gaugeId}`} inputMode="numeric" value={maxT} onChange={e => setMaxT(e.target.value)} /></label>
    <button type="submit">Set limits</button>
    <FailedBanner lasts={[set.last]} />
  </form>;
}

function ContractorAssignment({ gaugeId }: { gaugeId: string }) {
  const list = usePage(api.gaugeAssignments, { gaugeId });
  const roster = usePage(api.roster, {});
  const assign = useMutation(api.assignContractor);
  const unassign = useMutation(api.unassignContractor);
  const contractors = roster.items.filter(r => r.role === "contractor");
  const [who, setWho] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!who) return;
    void assign.run({ gaugeId, contractor: who });
  };
  return <div>
    <span>Serviced by: {"denied" in list.read ? "unavailable" : list.items.map(a => a.contractor).join(", ") || "nobody"}</span>
    <form onSubmit={submit} aria-label={`Assign contractor to ${gaugeId}`}>
      <label htmlFor={`contractor-${gaugeId}`}>Contractor</label>
      <select id={`contractor-${gaugeId}`} value={who} onChange={e => setWho(e.target.value)}>
        <option value="">Choose a contractor</option>
        {contractors.map(c => <option key={c.id} value={c.principal}>{c.principal}</option>)}
      </select>
      <button type="submit">Assign</button>
    </form>
    {"denied" in list.read ? null : list.items.map(a => <button key={a.id} onClick={() => void unassign.run({ gaugeId, contractor: a.contractor })} aria-label={`Unassign ${a.contractor}`}>Unassign {a.contractor}</button>)}
    <FailedBanner lasts={[assign.last, unassign.last]} />
  </div>;
}

function ShiftsManager() {
  const shifts = usePage(api.shiftsList, {});
  const create = useMutation(api.createShift);
  const [label, setLabel] = useState("");
  const [starts, setStarts] = useState(localInput(Date.now() - 2 * 3600_000));
  const [ends, setEnds] = useState(localInput(Date.now() + 6 * 3600_000));
  const [open, setOpen] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    void create.run({ label: label.trim(), startsAt: Date.parse(starts), endsAt: Date.parse(ends) });
  };
  return <div>
    <h3>Shifts and rounds</h3>
    <form onSubmit={submit} aria-label="Create a shift">
      <label>Shift label<input aria-label="Shift label" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} /></label>
      <label>Starts<input aria-label="Shift starts" type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} /></label>
      <label>Ends<input aria-label="Shift ends" type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} /></label>
      <button type="submit">Create shift</button>
    </form>
    {"denied" in shifts.read
      ? <p role="alert">Not available: {shifts.read.denied.message}</p>
      : <ul>
        {shifts.items.map(s => <li key={s.id}>
          <button onClick={() => setOpen(open === s.id ? "" : s.id)}>{s.label} ({fmtTime(s.startsAt)} – {fmtTime(s.endsAt)})</button>
          {open === s.id && <ShiftDetail shiftId={s.id} />}
        </li>)}
      </ul>}
    {shifts.hasMore && <button onClick={shifts.loadMore}>Show more</button>}
    <FailedBanner lasts={[create.last]} />
  </div>;
}

function ShiftDetail({ shiftId }: { shiftId: string }) {
  const members = usePage(api.shiftMembersOf, { shift: shiftId });
  const roster = usePage(api.roster, {});
  const addMember = useMutation(api.addShiftMember);
  const schedule = useMutation(api.scheduleRound);
  const engineers = roster.items.filter(r => r.role === "engineer");
  const [who, setWho] = useState("");
  const [at, setAt] = useState(localInput(Date.now()));
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!who) return;
    void addMember.run({ shiftId, engineer: who });
  };
  const plan = (event: FormEvent) => {
    event.preventDefault();
    void schedule.run({ shiftId, scheduledAt: Date.parse(at) });
  };
  return <div>
    <h4>Members</h4>
    {"denied" in members.read ? <p role="alert">Not available.</p> : <ul>{members.items.map(m => <li key={m.id}>{m.engineer}</li>)}</ul>}
    <form onSubmit={add} aria-label={`Add engineer to ${shiftId}`}>
      <label htmlFor={`engineer-${shiftId}`}>Engineer</label>
      <select id={`engineer-${shiftId}`} value={who} onChange={e => setWho(e.target.value)}>
        <option value="">Choose an engineer</option>
        {engineers.map(e => <option key={e.id} value={e.principal}>{e.principal}</option>)}
      </select>
      <button type="submit">Add to shift</button>
    </form>
    <h4>Schedule a round</h4>
    <form onSubmit={plan} aria-label={`Schedule round on ${shiftId}`}>
      <label>At<input aria-label="Round time" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
      <button type="submit">Schedule round</button>
    </form>
    <RoundsList shift={shiftId} canWrite={false} />
    <FailedBanner lasts={[addMember.last, schedule.last]} />
  </div>;
}

function RosterManager() {
  const roster = usePage(api.roster, {});
  const assign = useMutation(api.assignRole);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<"engineer" | "chief" | "contractor" | "manager">("engineer");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!who) return;
    void assign.run({ who, role });
  };
  return <div>
    <h3>Roles</h3>
    {"denied" in roster.read
      ? <p role="alert">Not available: {roster.read.denied.message}</p>
      : <ul>{roster.items.map(r => <li key={r.id}>{r.principal}: {r.role}</li>)}</ul>}
    {roster.hasMore && <button onClick={roster.loadMore}>Show more</button>}
    <form onSubmit={submit} aria-label="Assign a role">
      <label>Account (principal)<input aria-label="Account principal" value={who} onChange={e => setWho(e.target.value)} placeholder="user:…" /></label>
      <label htmlFor="role-pick">Role</label>
      <select id="role-pick" value={role} onChange={e => setRole(e.target.value as typeof role)}>
        <option value="engineer">engineer</option>
        <option value="chief">chief</option>
        <option value="contractor">contractor</option>
        <option value="manager">manager</option>
      </select>
      <button type="submit">Assign role</button>
    </form>
    <FailedBanner lasts={[assign.last]} />
  </div>;
}

function ContractorScreen() {
  return <section aria-label="Contractor workspace">
    <h2>My equipment</h2>
    <GaugeHistory />
  </section>;
}

function ManagerScreen() {
  const now = Date.now();
  const [from, setFrom] = useState(localInput(now - 24 * 3600_000));
  const [to, setTo] = useState(localInput(now + 3600_000));
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  return <section aria-label="Manager workspace">
    <h2>Compliance reports</h2>
    <p>Rounds completed per shift. Individual gauge readings are not shown here.</p>
    <form aria-label="Compliance range" onSubmit={e => { e.preventDefault(); setRange({ from: Date.parse(from), to: Date.parse(to) }); }}>
      <label>From<input aria-label="Compliance from" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>To<input aria-label="Compliance to" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button type="submit">Show report</button>
    </form>
    {range && <ComplianceList from={range.from} to={range.to} />}
  </section>;
}

function ComplianceList({ from, to }: { from: number; to: number }) {
  const report = usePage(api.compliance, { from, to });
  return <div>
    {"denied" in report.read
      ? <p role="alert">Not available: {report.read.denied.message}</p>
      : <ul>
        {report.items.map(r => <li key={r.id}>
          {r.shift && typeof r.shift === "object" && "label" in r.shift ? (r.shift as { label: string }).label : r.shift} · {fmtTime(r.scheduledAt)} · {r.status}
        </li>)}
      </ul>}
    {report.hasMore && <button onClick={report.loadMore}>Show more</button>}
  </div>;
}
