import { useState, type FormEvent } from "react";
import { existence, isDenied, isFailed, isLoading } from "snapback4/contract";
import { useAuth, useLink, useMutation, usePage, useSignedInViewer, type UseMutation, type UsePage } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

function Todos() {
  const auth = useAuth(), link = useLink();
  // Never null here: Account renders this screen only once signed in.
  const viewer = useSignedInViewer();
  // A live query: it re-renders on every change, including this device's own
  // unconfirmed writes (marked `pending`) and changes from other devices.
  // usePage is for a query that takes `c: cursor ?`; any other query reads
  // with useQuery(api.op, args), which returns the Read itself (render it
  // with matchRead from snapback4/contract).
  // Keep the draft in this screen, above release-sensitive read children.
  const [title, setTitle] = useState("");
  const todos = usePage(api.list, {});
  const add = useMutation(api.add), toggle = useMutation(api.toggle), remove = useMutation(api.remove);
  // The button and Enter share one command. A click admits the intent in
  // that event; preventDefault avoids a second form submission.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void add.run({ title: title.trim() });
    setTitle("");
  };
  const failed = [add.last, toggle.last, remove.last].find(isFailed);
  return <main>
    <header>
      <h1>Todos</h1>
      <span role="status">{viewer} · {link === "online" ? "Online" : "Offline"}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    <form onSubmit={submit}>
      <input aria-label="Task" value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs doing?" maxLength={200} />
      <button type="submit" onClick={submit}>Add</button>
    </form>
    <p role="status">{add.last?.state ?? "Ready"}</p>
    {failed && <p role="alert">{failed.why.message}</p>}
    <TodoList todos={todos} toggle={toggle} remove={remove} />
  </main>;
}

// Hook results are named by the operation for props: UsePage<typeof api.list>,
// UseMutation<typeof api.toggle>, and UseQuery<typeof api.op> for useQuery.
function TodoList({ todos, toggle, remove }: { todos: UsePage<typeof api.list>; toggle: UseMutation<typeof api.toggle>; remove: UseMutation<typeof api.remove> }) {
  return <>
    {isLoading(todos.read) && <p>Loading…</p>}
    {isDenied(todos.read) && <p role="alert">Not available: {todos.read.denied.message}</p>}
    {existence(todos.read) === "absent" && <p>No tasks yet.</p>}
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
  </>;
}
