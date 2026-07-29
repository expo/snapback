import { useEffect, useMemo, useRef, useState } from "react";
import { db, id } from "./db";
import "./App.css";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  assignee: string;
  dueDate: string;
  revision: number;
};

type List = {
  id: string;
  name: string;
  ordinal: number;
  taskOrder: unknown;
  tasks: Task[];
};

function TodoApp({ userId }: { userId: string }) {
  const connection = db.useConnectionStatus();
  const [newTitle, setNewTitle] = useState("");
  const [settlement, setSettlement] = useState("All changes settled");
  const [loggedOut, setLoggedOut] = useState(false);
  const query = db.useQuery({
    workspaces: {
      memberships: { user: {} },
      lists: { tasks: {} },
    },
  });

  const lists = useMemo(
    () =>
      ((query.data?.workspaces?.[0]?.lists ?? []) as List[]).sort(
        (a, b) => a.ordinal - b.ordinal,
      ),
    [query.data],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = lists.find((list) => list.id === selectedId) ?? lists[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const tasks = useMemo(() => {
    if (!selected) return [];
    const order = Array.isArray(selected.taskOrder)
      ? (selected.taskOrder as string[])
      : [];
    const rank = new Map(order.map((taskId, index) => [taskId, index]));
    return [...selected.tasks].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [selected]);

  async function settle(operation: Promise<{ status: string }>) {
    setSettlement(connection === "authenticated" ? "Saving…" : "Queued offline");
    try {
      const result = await operation;
      setSettlement(result.status === "enqueued" ? "Queued offline" : "All changes settled");
    } catch (error) {
      setSettlement(error instanceof Error ? error.message : "Write failed");
    }
  }

  function addTask() {
    const title = newTitle.trim();
    if (!title || !selected) return;
    const taskId = id();
    const order = [...tasks.map((task) => task.id), taskId];
    setNewTitle("");
    void settle(
      db.transact([
        db.tx.tasks[taskId]
          .update({
            title,
            completed: false,
            assignee: "Alice",
            dueDate: "2026-08-01",
            seedKey: `created:${taskId}`,
            revision: 0,
          })
          .link({ list: selected.id }),
        db.tx.lists[selected.id].update({ taskOrder: order }),
      ]),
    );
  }

  function updateTask(task: Task, patch: Partial<Task>) {
    void settle(
      db.transact(
        db.tx.tasks[task.id].update({
          ...patch,
          revision: task.revision + 1,
        }),
      ),
    );
  }

  function moveTask(task: Task, direction: -1 | 1) {
    if (!selected) return;
    const order = tasks.map((item) => item.id);
    const from = order.indexOf(task.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void settle(db.transact(db.tx.lists[selected.id].update({ taskOrder: order })));
  }

  function deleteTask(task: Task) {
    if (!selected) return;
    const order = tasks.filter((item) => item.id !== task.id).map((item) => item.id);
    void settle(
      db.transact([
        db.tx.lists[selected.id].update({ taskOrder: order }),
        db.tx.tasks[task.id].delete(),
      ]),
    );
  }

  async function logOut() {
    setLoggedOut(true);
    await db.auth.signOut();
  }

  if (loggedOut) return null;

  return (
    <div
      className="app-shell"
      data-ready={!query.isLoading}
      data-user-id={userId}
      data-task-count={lists.reduce((count, list) => count + list.tasks.length, 0)}
      data-connection={connection}
      data-testid="todo-shell"
    >
      <aside className="rail" aria-label="Bakeoff applications">
        <div className="mark" aria-hidden="true">ID</div>
        <button className="rail-button active" type="button">todo</button>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Calibration app · InstantDB</p>
            <h1>Offline shared Todo</h1>
          </div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">{connection}</span>
            <button aria-label="Log out" className="avatar" onClick={logOut} type="button">
              A
            </button>
          </div>
        </header>
        <section className="workspace two-column" aria-label="Todo workspace">
          <nav className="panel list-nav" aria-label="Task lists">
            <button className="primary" data-testid="todo-new-list" type="button">
              + New list
            </button>
            {lists.map((list) => (
              <button
                className={list.id === selected?.id ? "nav-row selected" : "nav-row"}
                key={list.id}
                onClick={() => setSelectedId(list.id)}
                type="button"
              >
                {list.name} {list.tasks.length}
              </button>
            ))}
          </nav>
          <div className="panel content-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Shared workspace</p>
                <h2>{selected?.name ?? "No authorized workspace"}</h2>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  addTask();
                }}
              >
                <label className="new-task">
                  New task
                  <input
                    aria-label="New task"
                    onChange={(event) => setNewTitle(event.target.value)}
                    value={newTitle}
                  />
                </label>
                <button className="primary" data-testid="todo-add-task" type="submit">
                  Add
                </button>
              </form>
            </div>
            {query.error ? <p role="alert">{query.error.message}</p> : null}
            <ol className="task-table" aria-label="Tasks">
              {tasks.map((task, index) => (
                <li
                  className="task-row"
                  data-completed={task.completed}
                  data-position={index}
                  data-task-id={task.id}
                  key={task.id}
                >
                  <input
                    aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                    checked={task.completed}
                    onChange={() => updateTask(task, { completed: !task.completed })}
                    type="checkbox"
                  />
                  <div>
                    <input
                      aria-label={`Title ${task.title}`}
                      defaultValue={task.title}
                      key={`${task.id}:${task.revision}:${task.title}`}
                      onBlur={(event) => {
                        const title = event.currentTarget.value.trim();
                        if (title && title !== task.title) updateTask(task, { title });
                      }}
                    />
                    <span>{task.assignee} · {task.dueDate}</span>
                  </div>
                  <div className="row-actions">
                    <button
                      aria-label={`Move ${task.title} up`}
                      disabled={index === 0}
                      onClick={() => moveTask(task, -1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move ${task.title} down`}
                      disabled={index === tasks.length - 1}
                      onClick={() => moveTask(task, 1)}
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`Delete ${task.title}`}
                      onClick={() => deleteTask(task)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="offline-note" data-testid="todo-offline-state">
              {settlement}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const auth = db.useAuth();
  const started = useRef(false);
  const [signedOutByUser, setSignedOutByUser] = useState(false);

  useEffect(() => {
    if (!auth.isLoading && !auth.user && !auth.error && !started.current && !signedOutByUser) {
      started.current = true;
      void db.auth.signInAsGuest().catch(() => {
        started.current = false;
      });
    }
  }, [auth, signedOutByUser]);

  if (auth.isLoading) return <p data-testid="auth-state">Loading native auth…</p>;
  if (auth.error) return <p role="alert">{auth.error.message}</p>;
  if (!auth.user) {
    return (
      <button
        data-testid="guest-login"
        onClick={() => {
          setSignedOutByUser(false);
          void db.auth.signInAsGuest();
        }}
        type="button"
      >
        Sign in as guest
      </button>
    );
  }
  return <TodoApp userId={auth.user.id} />;
}
