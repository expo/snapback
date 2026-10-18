import { useEffect, useState, type FormEvent } from "react";
import { AppProvider, useAuth, useAppReady, useClient, useMutation, useNow, usePage, useQueryResult, useSignedInViewer, type UsePage } from "snapback4/react";
import { isDenied, isFailed, isLoading, isReady } from "snapback4/contract";
import { api } from "../snapback/generated/api.ts";
import { app } from "./client.ts";

export function App() {
  return <AppProvider app={app}><Account /></AppProvider>;
}

function Account() {
  const auth = useAuth();
  const ready = useAppReady();
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in" && !ready) return <p>{auth.why?.message ?? "Opening…"}</p>;
  if (auth.state === "signed-in") return <Shell />;
  return <SignIn />;
}

function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const go = async (mode: "signup" | "login") => {
    const result = await (mode === "signup" ? auth.signup(email, password) : auth.login(email, password));
    if (!result.ok) setProblem(result.why.message);
  };
  return <main>
    <h1>Orchard Spray Re-entry</h1>
    <p>{problem || auth.why?.message || "Sign up or log in with your orchard account."}</p>
    <label>Email <input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
    <label>Password <input aria-label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
    <div>
      <button onClick={() => void go("signup")}>Sign up</button>
      <button onClick={() => void go("login")}>Log in</button>
    </div>
  </main>;
}

type Role = "applicator" | "picker" | "manager" | "crew_lead" | "inspector";

function Shell() {
  const auth = useAuth();
  const viewer = useSignedInViewer();
  const {data: roleRow, why} = useQueryResult(api.myRole, {});
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  return <main>
    <header>
      <h1>Orchard Spray Re-entry</h1>
      <span role="status">{viewer}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    {why ? <p role="alert">Not available: {why.message}</p> : roleRow === undefined ? <p>Loading your role…</p> : roleRow === null ? <Register /> : <Home role={roleRow.role as Role} selectedBlock={selectedBlock} onSelectBlock={setSelectedBlock} />}
  </main>;
}

function Register() {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"applicator" | "picker" | "crew_lead" | "inspector">("picker");
  const register = useMutation(api.register);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) return;
    void register.run({ displayName: displayName.trim(), role });
  };
  return <section>
    <h2>Join the crew</h2>
    <p>Managers are added by an existing manager; pick your crew role.</p>
    <form onSubmit={submit}>
      <label>Display name <input aria-label="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={80} /></label>
      <label>Role <select aria-label="Role" value={role} onChange={e => setRole(e.target.value as typeof role)}>
        <option value="picker">Picker</option>
        <option value="applicator">Applicator</option>
        <option value="crew_lead">Crew lead</option>
        <option value="inspector">Inspector</option>
      </select></label>
      <button type="submit">Register</button>
    </form>
    <WriteStatus last={register.last} />
  </section>;
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString();
}

function Home({ role, selectedBlock, onSelectBlock }: { role: Role; selectedBlock: string | null; onSelectBlock: (id: string | null) => void }) {
  const blocks = usePage(api.blockList, {});
  return <>
    <p role="status">Signed in as {role.replace("_", " ")}</p>
    {role === "inspector" && <p>State inspector access: application records are read-only.</p>}
    {role === "manager" && <ManagerPanel />}
    {role === "applicator" && <ApplicatorPanel />}
    {role === "crew_lead" && <LeadPanel />}
    {role === "picker" && <PickerPanel />}
    <section>
      <h2>Blocks</h2>
      {isLoading(blocks.read) && <p>Loading blocks…</p>}
      {isDenied(blocks.read) && <p role="alert">Not available: {blocks.read.denied.message}</p>}
      <BlockList blocks={blocks} onSelect={onSelectBlock} />
    </section>
    {selectedBlock !== null && <BlockDetail block={selectedBlock} role={role} onClose={() => onSelectBlock(null)} />}
  </>;
}

function BlockList({ blocks, onSelect }: { blocks: UsePage<typeof api.blockList>; onSelect: (id: string) => void }) {
  const nextReopen = blocks.items.filter(b => b.closedUntil > Date.now()).map(b => b.closedUntil);
  useNow(nextReopen.length === 0 ? null : Math.min(...nextReopen));
  const now = Date.now();
  if (blocks.items.length === 0) return <p>No blocks yet.</p>;
  return <>
    <ul>
      {blocks.items.map(b => {
        const open = b.closedUntil <= now;
        return <li key={b.id}>
          <button onClick={() => onSelect(b.id)} aria-label={`Open ${b.name}`}>{b.name}</button>
          {" "}{open ? "Open" : `Closed, reopens ${fmtTime(b.closedUntil)}`}
        </li>;
      })}
    </ul>
    {blocks.hasMore && <button onClick={blocks.loadMore}>Show more</button>}
  </>;
}

function WriteStatus({ last }: { last: unknown }) {
  const state = typeof last === "object" && last !== null && "state" in last && typeof (last as { state: unknown }).state === "string"
    ? (last as { state: string }).state
    : "Ready";
  const failed = [last].find(isFailed);
  return <>
    <p role="status">{state}</p>
    {failed && <p role="alert">{failed.why.message}</p>}
  </>;
}

function ManagerPanel() {
  const [blockName, setBlockName] = useState("");
  const [productName, setProductName] = useState("");
  const [reiHours, setReiHours] = useState("24");
  const [allowsEarly, setAllowsEarly] = useState(true);
  const addBlock = useMutation(api.addBlock);
  const addProduct = useMutation(api.addProduct);
  const products = usePage(api.productList, {});
  const submitBlock = (event: FormEvent) => {
    event.preventDefault();
    if (!blockName.trim()) return;
    void addBlock.run({ name: blockName.trim() });
    setBlockName("");
  };
  const submitProduct = (event: FormEvent) => {
    event.preventDefault();
    const hours = Number(reiHours);
    if (!productName.trim() || !Number.isInteger(hours) || hours < 1 || hours > 120) return;
    void addProduct.run({ name: productName.trim(), reiHours: hours, allowsEarlyEntry: allowsEarly });
    setProductName("");
  };
  return <>
    <section>
      <h2>Add a block</h2>
      <form onSubmit={submitBlock}>
        <label>Block name <input aria-label="Block name" value={blockName} onChange={e => setBlockName(e.target.value)} maxLength={80} /></label>
        <button type="submit" onClick={submitBlock}>Add block</button>
      </form>
      <WriteStatus last={addBlock.last} />
    </section>
    <section>
      <h2>Add a product</h2>
      <form onSubmit={submitProduct}>
        <label>Product name <input aria-label="Product name" value={productName} onChange={e => setProductName(e.target.value)} maxLength={80} /></label>
        <label>REI hours <input aria-label="REI hours" inputMode="numeric" value={reiHours} onChange={e => setReiHours(e.target.value)} /></label>
        <label>Allows early entry <input aria-label="Allows early entry" type="checkbox" checked={allowsEarly} onChange={e => setAllowsEarly(e.target.checked)} /></label>
        <button type="submit" onClick={submitProduct}>Add product</button>
      </form>
      <WriteStatus last={addProduct.last} />
      <ul>
        {products.items.map(p => <li key={p.id}>{p.name} — REI {p.reiHours}h{!p.allowsEarlyEntry && " — no early entry"}</li>)}
      </ul>
    </section>
  </>;
}

function ApplicatorPanel() {
  const client = useClient();
  const blocks = usePage(api.blockList, {});
  const products = usePage(api.productList, {});
  const [block, setBlock] = useState("");
  const [product, setProduct] = useState("");
  const [rate, setRate] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const logSpray = useMutation(api.logSpray);
  useEffect(() => {
    const firstBlock = blocks.items[0];
    const firstProduct = products.items[0];
    if (!block && firstBlock) setBlock(firstBlock.id);
    if (!product && firstProduct) setProduct(firstProduct.id);
  }, [block, product, blocks.items, products.items]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!block || !product || !rate.trim() || busy) return;
    setBusy(true);
    try {
      let labelPhoto: { id: string } | null = null;
      if (photo) {
        const up = await client.upload(photo);
        if (!up.ok) return;
        labelPhoto = { id: up.asset.id };
      }
      await logSpray.run({ block, product, rate: rate.trim(), labelPhoto });
      setRate("");
      setPhoto(null);
    } finally {
      setBusy(false);
    }
  };
  return <section>
    <h2>Log a spray</h2>
    <form onSubmit={submit}>
      <label>Block <select aria-label="Block" value={block} onChange={e => setBlock(e.target.value)}>
        {blocks.items.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select></label>
      <label>Product <select aria-label="Product" value={product} onChange={e => setProduct(e.target.value)}>
        {products.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>Rate <input aria-label="Rate" value={rate} onChange={e => setRate(e.target.value)} maxLength={60} placeholder="2 pt/acre" /></label>
      <label>Label photo <input aria-label="Label photo" type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></label>
      <button type="submit" disabled={busy}>Log spray</button>
    </form>
    <WriteStatus last={logSpray.last} />
  </section>;
}

function LeadPanel() {
  const blocks = usePage(api.blockList, {});
  const roster = usePage(api.roster, {});
  const [block, setBlock] = useState("");
  const [picker, setPicker] = useState("");
  const assign = useMutation(api.assign);
  const pickers = roster.items.filter(r => r.role === "picker");
  useEffect(() => {
    const firstBlock = blocks.items[0];
    const firstPicker = pickers[0];
    if (!block && firstBlock) setBlock(firstBlock.id);
    if (!picker && firstPicker) setPicker(firstPicker.principal);
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!block || !picker) return;
    void assign.run({ block, picker });
  };
  return <section>
    <h2>Assign a picker</h2>
    <p>Pickers can only be assigned to open blocks.</p>
    <form onSubmit={submit}>
      <label>Block <select aria-label="Block" value={block} onChange={e => setBlock(e.target.value)}>
        {blocks.items.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select></label>
      <label>Picker <select aria-label="Picker" value={picker} onChange={e => setPicker(e.target.value)}>
        {pickers.map(r => <option key={r.principal} value={r.principal}>{r.principal}</option>)}
      </select></label>
      <button type="submit" onClick={submit}>Assign</button>
    </form>
    <WriteStatus last={assign.last} />
  </section>;
}

function PickerPanel() {
  const mine = usePage(api.myAssignments, {});
  const blocks = usePage(api.blockList, {});
  const nameOf = (id: string) => blocks.items.find(b => b.id === id)?.name ?? id;
  return <section>
    <h2>My assignments</h2>
    {isLoading(mine.read) && <p>Loading…</p>}
    {isDenied(mine.read) && <p role="alert">Not available: {mine.read.denied.message}</p>}
    {mine.items.length === 0 ? <p>No assignments yet.</p> : <ul>
      {mine.items.map(a => <li key={a.id}>{nameOf(a.block)} — assigned {fmtTime(a.at)}</li>)}
    </ul>}
  </section>;
}

function ShortenForm({ applicationId, currentEnd, appliedAt }: { applicationId: string; currentEnd: number; appliedAt: number }) {
  const shorten = useMutation(api.shorten);
  const toLocal = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [value, setValue] = useState(() => toLocal(currentEnd - 3600_000));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms) || ms < appliedAt || ms >= currentEnd) return;
    void shorten.run({ application: applicationId, newEndsAt: ms });
  };
  return <form onSubmit={submit}>
    <label>Reopen at <input aria-label="Reopen at" type="datetime-local" value={value} onChange={e => setValue(e.target.value)} /></label>
    <button type="submit" onClick={submit}>Shorten</button>
    <WriteStatus last={shorten.last} />
  </form>;
}

function BlockDetail({ block, role, onClose }: { block: string; role: Role; onClose: () => void }) {
  const apps = usePage(api.applicationsFor, { block });
  const assigns = usePage(api.assignmentsFor, { block });
  const products = usePage(api.productList, {});
  const productOf = (id: string) => products.items.find(p => p.id === id);
  return <section>
    <h2>Block detail</h2>
    <button onClick={onClose}>Close detail</button>
    <h3>Applications</h3>
    {isLoading(apps.read) && <p>Loading…</p>}
    {isDenied(apps.read) && <p role="alert">Not available: {apps.read.denied.message}</p>}
    {apps.items.length === 0 ? <p>No applications logged.</p> : <ul>
      {apps.items.map(a => {
        const end = a.earlyEndsAt ?? a.reiEndsAt;
        const p = productOf(a.product);
        return <li key={a.id}>
          {p?.name ?? a.product} — {a.rate} — applied {fmtTime(a.appliedAt)} — reopens {fmtTime(end)}
          {end <= Date.now() ? " (open)" : " (closed)"}
          {a.labelPhoto && " — label photo attached"}
          {role === "manager" && p?.allowsEarlyEntry && end > Date.now() && <ShortenForm applicationId={a.id} currentEnd={end} appliedAt={a.appliedAt} />}
        </li>;
      })}
    </ul>}
    <h3>Assignments</h3>
    {assigns.items.length === 0 ? <p>No assignments.</p> : <ul>
      {assigns.items.map(a => <li key={a.id}>{a.picker} — assigned {fmtTime(a.at)}</li>)}
    </ul>}
  </section>;
}
