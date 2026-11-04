import { useState, type FormEvent } from "react";
import { AppProvider, useAuth, useAppReady, ReadState, useLink, useMutation, usePage, useSignedInViewer, type UseMutation, type UsePage } from "snapback4/react";
import { existence, isFailed } from "snapback4/contract";
import { api } from "../snapback/generated/api.ts";
import { app } from "./client.ts";
import { matchesFilter, prepareTitle, type ListFilter } from "./shared.ts";

export function App() { return <AppProvider app={app}><Account /></AppProvider>; }
function Account() {
  const auth = useAuth();
  const ready = useAppReady();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in" && !ready) return <p>{auth.why?.message ?? "Opening…"}</p>;
  if (auth.state === "signed-in") return <Notes />;
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

function Notes() {
  const auth = useAuth(), link = useLink();
  // Never null here: Account renders this screen only once signed in.
  const viewer = useSignedInViewer();
  // A live query: it re-renders on every change, including this device's own
  // unconfirmed writes (marked `pending`) and changes from other devices.
  // usePage is for a query that takes `c: cursor ?`; any other query reads
  // with useQuery(api.op, args), which returns the Read itself (render it
  // with ReadState for lists, or matchRead from snapback4/contract).
  // Keep the draft in this screen, above release-sensitive read children.
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const notes = usePage(api.list, {});
  const add = useMutation(api.add), toggle = useMutation(api.toggle), remove = useMutation(api.remove);
  // The button and Enter share one command. A click admits the intent in
  // that event; preventDefault avoids a second form submission.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = prepareTitle(title);
    if (!value) return;
    void add.run({ title: value });
    setTitle("");
  };
  const failed = [add.last, toggle.last, remove.last].find(isFailed);
  return <main>
    <header>
      <h1>Notes</h1>
      <span role="status">{viewer} · {link === "online" ? "Online" : "Offline"}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    <form onSubmit={submit}>
      <label htmlFor="task-title">Note</label>
      <textarea id="task-title" aria-label="Note" value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" maxLength={200} />
      <button type="submit" onClick={submit}>Add</button>
    </form>
    <p role="status">{add.last?.state ?? "Ready"}</p>
    {failed && <p role="alert">{failed.why.message}</p>}
    <label htmlFor="task-filter">Note status</label>
    <select id="task-filter" aria-label="Note status" value={filter} onChange={event => {
      const value = event.target.value;
      if (value === "all" || value === "open" || value === "done") setFilter(value);
    }}><option value="all">All notes</option><option value="open">Open notes</option><option value="done">Completed notes</option></select>
    <NoteList filter={filter} notes={notes} toggle={toggle} remove={remove} />
  </main>;
}

// Hook results are named by the operation for props: UsePage<typeof api.list>,
// UseMutation<typeof api.toggle>, and UseQuery<typeof api.op> for useQuery.
function NoteList({ filter, notes, toggle, remove }: { filter: ListFilter; notes: UsePage<typeof api.list>; toggle: UseMutation<typeof api.toggle>; remove: UseMutation<typeof api.remove> }) {
  return <>
    <ReadState read={notes} loading={<p>Loading…</p>}
      denied={why => <p role="alert">Not available: {why.message}</p>}
      empty={<p>{existence(notes.read) === "absent" ? "No notes yet." : "No known notes yet."}</p>}>
    {() => <ul>
      {notes.items.filter(note => matchesFilter(note.done, filter)).map(note => <li key={note.id} className={note.pending ? "pending" : undefined}>
        <label>
          <input type="checkbox" checked={note.done} onChange={() => void toggle.run({ noteId: note.id })} />
          {note.title}
        </label>
        <button onClick={() => void remove.run({ noteId: note.id })} aria-label={`Delete ${note.title}`}>×</button>
      </li>)}
    </ul>}
    </ReadState>
    {notes.hasMore && <button onClick={notes.loadMore}>Show more</button>}
  </>;
}
