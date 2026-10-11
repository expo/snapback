import { useState, type FormEvent } from "react";
import { isDenied, isLoading } from "snapback4/contract";
import { AppProvider, useAuth, useLink, useMutation, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { app } from "./client.ts";

export function App() {
  return <AppProvider app={app}><Account /></AppProvider>;
}

// Every read and write runs as the signed-in viewer, so sign in first.
function Account() {
  const auth = useAuth();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <p>Restoring your session…</p>;
  if (auth.state === "signed-in") return <Todos />;
  const signIn = async () => {
    const result = await auth.guest();
    if (!result.ok) setProblem(result.why.message);
  };
  return <main>
    <h1>Todos</h1>
    <p>{problem || auth.why?.message || "Signed out"}</p>
    <button onClick={() => void signIn()}>Continue as a guest</button>
  </main>;
}

function Todos() {
  const auth = useAuth(), link = useLink();
  // A live query: it re-renders on every change, including this device's own
  // unconfirmed writes (marked `pending`) and changes from other devices.
  const todos = usePage(api.list, {});
  const add = useMutation(api.add), toggle = useMutation(api.toggle), remove = useMutation(api.remove);
  const [title, setTitle] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void add.run({ title: title.trim() });
    setTitle("");
  };
  const failed = [add.last, toggle.last, remove.last].find(write => write?.state === "failed");
  return <main>
    <header>
      <h1>Todos</h1>
      <span role="status">{link === "online" ? "Online" : "Offline"}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    <form onSubmit={submit}>
      <input value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" maxLength={200} />
      <button type="submit">Add</button>
    </form>
    {failed?.state === "failed" && <p role="alert">{failed.why.message}</p>}
    {isLoading(todos.read) && <p>Loading…</p>}
    {isDenied(todos.read) && <p role="alert">{todos.read.denied.message}</p>}
    <ul>
      {todos.items.map(todo => <li key={todo.id} className={todo.pending ? "pending" : undefined}>
        <label>
          <input type="checkbox" checked={todo.done} onChange={() => void toggle.run({ todoId: todo.id })} />
          {todo.title}
        </label>
        <button onClick={() => void remove.run({ todoId: todo.id })} aria-label={`Delete ${todo.title}`}>×</button>
      </li>)}
    </ul>
    {todos.hasMore && <button onClick={todos.loadMore}>Show more</button>}
  </main>;
}
