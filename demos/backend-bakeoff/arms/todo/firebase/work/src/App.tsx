import { useEffect, useMemo, useState } from "react";
import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocsFromCache,
  increment,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, firestore } from "./firebase";
import "./App.css";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  assignee: string;
  dueDate: string;
  listId: string;
  revision: number;
};
type List = {
  id: string;
  name: string;
  ordinal: number;
  taskOrder: string[];
};

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="login-card">
      <p className="eyebrow">Firebase Authentication emulator</p>
      <h1>Offline shared Todo</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void signInWithEmailAndPassword(auth, email, password)
          .catch((reason) => setError(reason instanceof Error ? reason.message : "Sign in failed"));
      }}>
        <label>Email<input aria-label="Email" onChange={(event) => setEmail(event.target.value)} value={email} /></label>
        <label>Password<input aria-label="Password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}

function Todo({ user }: { user: User }) {
  const [lists, setLists] = useState<List[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [listMetadata, setListMetadata] = useState({ fromCache: true, pendingWrites: false });
  const [taskMetadata, setTaskMetadata] = useState({ fromCache: true, pendingWrites: false });
  const [explicitCacheCounts, setExplicitCacheCounts] = useState({ lists: -1, tasks: -1 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const fromCache = listMetadata.fromCache || taskMetadata.fromCache;
  const pendingWrites = listMetadata.pendingWrites || taskMetadata.pendingWrites;

  useEffect(() => {
    let stopped = false;
    let denied = false;
    setReady(false);
    setError("");
    const listQuery = query(
      collection(firestore, "lists"),
      where("workspaceId", "==", "primary"),
      orderBy("ordinal"),
    );
    const taskQuery = query(
      collection(firestore, "tasks"),
      where("workspaceId", "==", "primary"),
    );
    const onDenied = (reason: Error) => {
      denied = true;
      setLists([]);
      setTasks([]);
      setReady(true);
      setError(reason.message);
    };
    void Promise.all([
      getDocsFromCache(listQuery),
      getDocsFromCache(taskQuery),
    ]).then(([listSnapshot, taskSnapshot]) => {
      if (stopped || denied) return;
      setLists(listSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as List));
      setTasks(taskSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Task));
      setExplicitCacheCounts({ lists: listSnapshot.size, tasks: taskSnapshot.size });
      setListMetadata({ fromCache: true, pendingWrites: listSnapshot.metadata.hasPendingWrites });
      setTaskMetadata({ fromCache: true, pendingWrites: taskSnapshot.metadata.hasPendingWrites });
      setReady(true);
    }).catch(() => {
      // The listeners below remain the authoritative online path.
    });
    const stopLists = onSnapshot(
      listQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        setLists(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as List));
        setListMetadata({
          fromCache: snapshot.metadata.fromCache,
          pendingWrites: snapshot.metadata.hasPendingWrites,
        });
        setReady(true);
      },
      onDenied,
    );
    const stopTasks = onSnapshot(
      taskQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        setTasks(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Task));
        setTaskMetadata({
          fromCache: snapshot.metadata.fromCache,
          pendingWrites: snapshot.metadata.hasPendingWrites,
        });
        setReady(true);
      },
      onDenied,
    );
    return () => {
      stopped = true;
      stopLists();
      stopTasks();
    };
  }, [user.uid]);

  const selected = lists.find((list) => list.id === selectedId) ?? lists[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);
  const selectedTasks = useMemo(() => {
    if (!selected) return [];
    const rank = new Map(selected.taskOrder.map((taskId, index) => [taskId, index]));
    return tasks.filter((task) => task.listId === selected.id).sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [selected, tasks]);

  function addTask() {
    const title = newTitle.trim();
    if (!title || !selected) return;
    const taskRef = doc(collection(firestore, "tasks"));
    const order = [...selectedTasks.map((task) => task.id), taskRef.id];
    const batch = writeBatch(firestore);
    batch.set(taskRef, {
      title,
      completed: false,
      assignee: "Alice",
      dueDate: "2026-08-01",
      listId: selected.id,
      workspaceId: "primary",
      seedKey: `created:${taskRef.id}`,
      revision: 0,
    });
    batch.update(doc(firestore, "lists", selected.id), { taskOrder: order });
    setNewTitle("");
    void batch.commit().catch((reason) => setError(reason.message));
  }

  function editTask(task: Task, patch: Partial<Task>) {
    void updateDoc(doc(firestore, "tasks", task.id), {
      ...patch,
      revision: increment(1),
    }).catch((reason) => setError(reason.message));
  }

  function moveTask(task: Task, direction: -1 | 1) {
    if (!selected) return;
    const order = selectedTasks.map((item) => item.id);
    const from = order.indexOf(task.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void updateDoc(doc(firestore, "lists", selected.id), { taskOrder: order })
      .catch((reason) => setError(reason.message));
  }

  function removeTask(task: Task) {
    if (!selected) return;
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, "lists", selected.id), {
      taskOrder: selectedTasks.filter((item) => item.id !== task.id).map((item) => item.id),
    });
    batch.delete(doc(firestore, "tasks", task.id));
    void batch.commit().catch((reason) => setError(reason.message));
  }

  return (
    <div
      className="app-shell"
      data-ready={ready}
      data-user-id={user.uid}
      data-task-count={tasks.length}
      data-cache-list-count={explicitCacheCounts.lists}
      data-cache-task-count={explicitCacheCounts.tasks}
      data-from-cache={fromCache}
      data-pending-writes={pendingWrites}
      data-testid="todo-shell"
    >
      <aside className="rail"><div className="mark">FB</div><button className="rail-button">todo</button></aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">Calibration app · Firebase</p><h1>Offline shared Todo</h1></div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">{fromCache ? "Cache" : "Server"}</span>
            <button aria-label="Log out" className="avatar" onClick={() => void signOut(auth)}>A</button>
          </div>
        </header>
        <section className="workspace two-column">
          <nav className="panel list-nav">
            <button className="primary" data-testid="todo-new-list">+ New list</button>
            {lists.map((list) => (
              <button className={list.id === selected?.id ? "nav-row selected" : "nav-row"} key={list.id} onClick={() => setSelectedId(list.id)}>
                {list.name} {tasks.filter((task) => task.listId === list.id).length}
              </button>
            ))}
          </nav>
          <div className="panel content-panel">
            <div className="section-heading">
              <div><p className="eyebrow">Shared workspace</p><h2>{selected?.name ?? "No authorized workspace"}</h2></div>
              <form onSubmit={(event) => { event.preventDefault(); addTask(); }}>
                <label className="new-task">New task<input aria-label="New task" onChange={(event) => setNewTitle(event.target.value)} value={newTitle} /></label>
                <button className="primary" data-testid="todo-add-task" type="submit">Add</button>
              </form>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <ol className="task-table">
              {selectedTasks.map((task, index) => (
                <li className="task-row" data-completed={task.completed} data-position={index} data-task-id={task.id} key={task.id}>
                  <input aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`} checked={task.completed} onChange={() => editTask(task, { completed: !task.completed })} type="checkbox" />
                  <div>
                    <input aria-label={`Title ${task.title}`} defaultValue={task.title} key={`${task.id}:${task.revision}:${task.title}`} onBlur={(event) => {
                      const title = event.currentTarget.value.trim();
                      if (title && title !== task.title) editTask(task, { title });
                    }} />
                    <span>{task.assignee} · {task.dueDate}</span>
                  </div>
                  <div className="row-actions">
                    <button aria-label={`Move ${task.title} up`} disabled={index === 0} onClick={() => moveTask(task, -1)}>↑</button>
                    <button aria-label={`Move ${task.title} down`} disabled={index === selectedTasks.length - 1} onClick={() => moveTask(task, 1)}>↓</button>
                    <button aria-label={`Delete ${task.title}`} onClick={() => removeTask(task)}>×</button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="offline-note" data-testid="todo-offline-state">
              {pendingWrites ? "Queued or saving" : fromCache ? "Retained cache" : "All changes settled"}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined) return <p>Loading native auth…</p>;
  return user ? <Todo user={user} /> : <Login />;
}
