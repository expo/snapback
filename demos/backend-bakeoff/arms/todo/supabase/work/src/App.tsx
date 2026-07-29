import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import "./App.css";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  assignee: string;
  due_date: string;
  list_id: string;
  revision: number;
};
type List = {
  id: string;
  name: string;
  ordinal: number;
  task_order: string[];
};

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="login-card">
      <p className="eyebrow">Supabase Auth</p>
      <h1>Shared Todo</h1>
      <form onSubmit={(event) => {
        event.preventDefault();
        setError("");
        void supabase.auth.signInWithPassword({ email, password })
          .then(({ error: reason }) => {
            if (reason) setError(reason.message);
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

function Todo({ session }: { session: Session }) {
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
      supabase.from("llp0102_todo_sb01_lists").select("id,name,ordinal,task_order").order("ordinal"),
      supabase.from("llp0102_todo_sb01_tasks").select(
        "id,title,completed,assignee,due_date,list_id,revision",
      ),
    ]);
    if (listResult.error) throw listResult.error;
    if (taskResult.error) throw taskResult.error;
    if (sequence !== loadSequence.current) return;
    setLists((listResult.data ?? []) as List[]);
    setTasks((taskResult.data ?? []) as Task[]);
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    void load()
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Query failed");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const channel = supabase
      .channel(`llp0102-todo-${session.user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "llp0102_todo_sb01_lists",
      }, () => void load().catch(() => {}))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "llp0102_todo_sb01_tasks",
      }, () => void load().catch(() => {}))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "llp0102_todo_sb01_memberships",
      }, () => void load().catch(() => {}))
      .subscribe((status) => {
        if (active) setChannelState(status.toLowerCase());
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [load, session.user.id]);

  const selected = lists.find((list) => list.id === selectedId) ?? lists[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);
  const selectedTasks = useMemo(() => {
    if (!selected) return [];
    const rank = new Map(selected.task_order.map((id, index) => [id, index]));
    return tasks.filter((task) => task.list_id === selected.id).sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [selected, tasks]);

  async function mutate(operation: () => PromiseLike<{ error: Error | null }>) {
    setPendingWrites(true);
    setError("");
    try {
      const result = await operation();
      if (result.error) throw result.error;
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mutation failed");
    } finally {
      setPendingWrites(false);
    }
  }

  function addTask() {
    const title = newTitle.trim();
    if (!title || !selected) return;
    setNewTitle("");
    void mutate(() => supabase.rpc("llp0102_todo_sb01_create_task", {
      selected_list: selected.id,
      task_title: title,
    }));
  }

  function editTask(task: Task, patch: { title?: string; completed?: boolean }) {
    void mutate(() => supabase.rpc("llp0102_todo_sb01_patch_task", {
      selected_task: task.id,
      task_title: patch.title ?? null,
      task_completed: patch.completed ?? null,
    }));
  }

  function moveTask(task: Task, direction: -1 | 1) {
    if (!selected) return;
    const order = selectedTasks.map((item) => item.id);
    const from = order.indexOf(task.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void mutate(() => supabase.from("llp0102_todo_sb01_lists")
      .update({ task_order: order }).eq("id", selected.id));
  }

  function removeTask(task: Task) {
    void mutate(() => supabase.rpc("llp0102_todo_sb01_delete_task", {
      selected_task: task.id,
    }));
  }

  return (
    <div
      className="app-shell"
      data-ready={ready}
      data-user-id={session.user.id}
      data-task-count={tasks.length}
      data-channel-state={channelState}
      data-pending-writes={pendingWrites}
      data-testid="todo-shell"
    >
      <aside className="rail"><div className="mark">SB</div><button className="rail-button">todo</button></aside>
      <main>
        <header className="topbar">
          <div><p className="eyebrow">Calibration app · Supabase</p><h1>Shared Todo</h1></div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">{channelState}</span>
            <button aria-label="Log out" className="avatar" onClick={() => void supabase.auth.signOut()}>A</button>
          </div>
        </header>
        <section className="workspace two-column">
          <nav className="panel list-nav">
            <button className="primary" data-testid="todo-new-list">+ New list</button>
            {lists.map((list) => (
              <button className={list.id === selected?.id ? "nav-row selected" : "nav-row"} key={list.id} onClick={() => setSelectedId(list.id)}>
                {list.name} {tasks.filter((task) => task.list_id === list.id).length}
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
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <p>Loading native auth…</p>;
  return session ? <Todo session={session} /> : <Login />;
}
