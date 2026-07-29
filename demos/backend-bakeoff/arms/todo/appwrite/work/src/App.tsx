import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Channel,
  ID,
  Permission,
  Query,
  Role,
  type Models,
  type RealtimeSubscription,
} from "appwrite";
import {
  account,
  databaseId,
  listsTableId,
  realtime,
  tables,
  tasksTableId,
} from "./appwrite";
import "./App.css";

const workspaceTeamId = "workspace-primary";
const teamPermissions = [
  Permission.read(Role.team(workspaceTeamId)),
  Permission.update(Role.team(workspaceTeamId)),
  Permission.delete(Role.team(workspaceTeamId)),
];

type Task = Models.Row & {
  title: string;
  completed: boolean;
  assignee: string;
  due_date: string;
  list_id: string;
  revision: number;
};
type List = Models.Row & {
  name: string;
  ordinal: number;
  task_order: string[];
  revision: number;
};

function Login({ onLogin }: { onLogin: (user: Models.User<Models.Preferences>) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="login-card">
      <p className="eyebrow">Appwrite Auth</p>
      <h1>Shared Todo</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void account.createEmailPasswordSession({ email, password })
          .then(async () => {
            await realtime.disconnect();
            onLogin(await account.get());
          })
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "Sign in failed");
          });
      }}>
        <label>Email<input aria-label="Email" onChange={(event) => setEmail(event.target.value)} value={email} /></label>
        <label>Password<input aria-label="Password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}

function Todo({
  user,
  onLogout,
}: {
  user: Models.User<Models.Preferences>;
  onLogout: () => void;
}) {
  const [lists, setLists] = useState<List[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [ready, setReady] = useState(false);
  const [channelState, setChannelState] = useState("connecting");
  const [pendingWrites, setPendingWrites] = useState(false);
  const [error, setError] = useState("");
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const [listResult, taskResult] = await Promise.all([
      tables.listRows<List>({
        databaseId,
        tableId: listsTableId,
        queries: [Query.orderAsc("ordinal"), Query.limit(100)],
        ttl: 0,
      }),
      tables.listRows<Task>({
        databaseId,
        tableId: tasksTableId,
        queries: [Query.limit(200)],
        ttl: 0,
      }),
    ]);
    if (sequence !== loadSequence.current) return;
    setLists(listResult.rows);
    setTasks(taskResult.rows);
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: RealtimeSubscription | undefined;
    const channels = [
      Channel.tablesdb(databaseId).table(listsTableId).row(),
      Channel.tablesdb(databaseId).table(tasksTableId).row(),
      Channel.team(workspaceTeamId),
    ];
    realtime.onOpen(() => {
      if (active) setChannelState("subscribed");
    });
    realtime.onClose(() => {
      if (active) setChannelState("closed");
    });
    realtime.onError(() => {
      if (active) setChannelState("error");
    });
    setReady(false);
    setError("");
    void Promise.all([
      load(),
      realtime.subscribe(channels, () => {
        void load().catch(() => {
          if (active) {
            setLists([]);
            setTasks([]);
          }
        });
      }).then((value) => {
        subscription = value;
      }),
    ]).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Query failed");
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
      void subscription?.unsubscribe();
    };
  }, [load, user.$id]);

  const selected = lists.find((list) => list.$id === selectedId) ?? lists[0];
  useEffect(() => {
    if (selected && selected.$id !== selectedId) setSelectedId(selected.$id);
  }, [selected, selectedId]);
  const selectedTasks = useMemo(() => {
    if (!selected) return [];
    const rank = new Map(selected.task_order.map((id, index) => [id, index]));
    return tasks.filter((task) => task.list_id === selected.$id).sort(
      (left, right) =>
        (rank.get(left.$id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.$id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [selected, tasks]);

  async function mutate(operation: () => Promise<void>) {
    setPendingWrites(true);
    setError("");
    try {
      await operation();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mutation failed");
      await load().catch(() => {});
    } finally {
      setPendingWrites(false);
    }
  }

  function addTask() {
    const title = newTitle.trim();
    if (!title || !selected) return;
    const rowId = ID.unique();
    const order = [...selected.task_order, rowId];
    setNewTitle("");
    void mutate(async () => {
      const transaction = await tables.createTransaction();
      await tables.createRow({
        databaseId,
        tableId: tasksTableId,
        rowId,
        data: {
          title,
          completed: false,
          assignee: user.name || user.email,
          due_date: "2026-08-15",
          list_id: selected.$id,
          revision: 1,
        },
        permissions: teamPermissions,
        transactionId: transaction.$id,
      });
      await tables.updateRow({
        databaseId,
        tableId: listsTableId,
        rowId: selected.$id,
        data: { task_order: order },
        transactionId: transaction.$id,
      });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    });
  }

  function editTask(task: Task, patch: { title?: string; completed?: boolean }) {
    void mutate(async () => {
      const transaction = await tables.createTransaction();
      await tables.updateRow({
        databaseId,
        tableId: tasksTableId,
        rowId: task.$id,
        data: patch,
        transactionId: transaction.$id,
      });
      await tables.incrementRowColumn({
        databaseId,
        tableId: tasksTableId,
        rowId: task.$id,
        column: "revision",
        value: 1,
        transactionId: transaction.$id,
      });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    });
  }

  function moveTask(task: Task, direction: -1 | 1) {
    if (!selected) return;
    const order = selectedTasks.map((item) => item.$id);
    const from = order.indexOf(task.$id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void mutate(async () => {
      const transaction = await tables.createTransaction();
      await tables.updateRow({
        databaseId,
        tableId: listsTableId,
        rowId: selected.$id,
        data: { task_order: order },
        transactionId: transaction.$id,
      });
      await tables.incrementRowColumn({
        databaseId,
        tableId: listsTableId,
        rowId: selected.$id,
        column: "revision",
        value: 1,
        transactionId: transaction.$id,
      });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    });
  }

  function removeTask(task: Task) {
    if (!selected) return;
    const order = selected.task_order.filter((id) => id !== task.$id);
    void mutate(async () => {
      const transaction = await tables.createTransaction();
      await tables.deleteRow({
        databaseId,
        tableId: tasksTableId,
        rowId: task.$id,
        transactionId: transaction.$id,
      });
      await tables.updateRow({
        databaseId,
        tableId: listsTableId,
        rowId: selected.$id,
        data: { task_order: order },
        transactionId: transaction.$id,
      });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    });
  }

  return (
    <div
      className="app-shell"
      data-ready={ready}
      data-user-id={user.$id}
      data-task-count={tasks.length}
      data-channel-state={channelState}
      data-pending-writes={pendingWrites}
      data-testid="todo-shell"
    >
      <aside className="rail"><div className="mark">AW</div><button className="rail-button">todo</button></aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">Calibration app · Appwrite</p><h1>Shared Todo</h1></div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">{channelState}</span>
            <button aria-label="Log out" className="avatar" onClick={() => {
              void realtime.disconnect()
                .then(() => account.deleteSession({ sessionId: "current" }))
                .finally(onLogout);
            }}>A</button>
          </div>
        </header>
        <section className="workspace two-column">
          <nav className="panel list-nav">
            <button className="primary" data-testid="todo-new-list">+ New list</button>
            {lists.map((list) => (
              <button className={list.$id === selected?.$id ? "nav-row selected" : "nav-row"} key={list.$id} onClick={() => setSelectedId(list.$id)}>
                {list.name} {tasks.filter((task) => task.list_id === list.$id).length}
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
                <li className="task-row" data-completed={task.completed} data-position={index} data-task-id={task.$id} key={task.$id}>
                  <input aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`} checked={task.completed} onChange={() => editTask(task, { completed: !task.completed })} type="checkbox" />
                  <div>
                    <input aria-label={`Title ${task.title}`} defaultValue={task.title} key={`${task.$id}:${task.revision}:${task.title}`} onBlur={(event) => {
                      const title = event.currentTarget.value.trim();
                      if (title && title !== task.title) editTask(task, { title });
                    }} />
                    <span>{task.assignee} · {task.due_date}</span>
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
              {pendingWrites ? "Waiting for remote response" : "No native durable offline queue"}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<Models.User<Models.Preferences> | null | undefined>();
  useEffect(() => {
    void account.get().then(setUser).catch(() => setUser(null));
  }, []);
  if (user === undefined) return <p>Loading native auth…</p>;
  return user
    ? <Todo onLogout={() => setUser(null)} user={user} />
    : <Login onLogin={setUser} />;
}
