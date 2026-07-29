import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useMemo, useState } from "react";
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import "./App.css";

function SignIn() {
  const { signIn } = useAuthActions();
  const [error, setError] = useState("");

  useEffect(() => {
    void signIn("anonymous").catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [signIn]);

  return (
    <main className="center-card">
      <p>Creating an isolated Convex Auth identity…</p>
      {error ? <pre>{error}</pre> : null}
    </main>
  );
}

function TodoApp() {
  const persona =
    new URLSearchParams(window.location.search).get("persona") ?? "visitor";
  const viewer = useQuery(api.todo.viewer);
  const snapshot = useQuery(api.todo.snapshot);
  const updateTask = useMutation(api.todo.updateTask);
  const createTask = useMutation(api.todo.createTask);
  const deleteTask = useMutation(api.todo.deleteTask);
  const moveTask = useMutation(api.todo.moveTask);
  const { signOut } = useAuthActions();
  const [selectedListId, setSelectedListId] = useState<Id<"lists"> | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!selectedListId && snapshot?.lists[0]) {
      setSelectedListId(snapshot.lists[0]._id);
    }
  }, [selectedListId, snapshot]);

  const tasks = useMemo(
    () =>
      (snapshot?.tasks ?? [])
        .filter((task) => task.listId === selectedListId)
        .sort((left, right) => left.position - right.position),
    [selectedListId, snapshot],
  );

  const totalTasks = snapshot?.tasks.length ?? 0;
  const ready = viewer !== undefined && snapshot !== undefined;
  return (
    <main
      className="app-shell"
      data-ready={ready}
      data-persona={persona}
      data-user-id={viewer?.userId ?? ""}
      data-member={viewer?.activeMember ?? false}
      data-task-count={totalTasks}
    >
      <header>
        <div>
          <p className="eyebrow">LLP 0102 · Convex</p>
          <h1>Todo calibration</h1>
        </div>
        <div className="identity">
          <strong>{persona}</strong>
          <span>{viewer?.activeMember ? viewer.role : "outsider"}</span>
          <button type="button" onClick={() => void signOut()}>
            Log out
          </button>
        </div>
      </header>

      <div className="status" data-testid="cache-status">
        {ready
          ? `${totalTasks} authorized tasks in the live client cache`
          : "Loading Convex subscription…"}
      </div>

      <section className="workspace">
        <nav>
          {(snapshot?.lists ?? []).map((list) => (
            <button
              className={list._id === selectedListId ? "selected" : ""}
              key={list._id}
              onClick={() => setSelectedListId(list._id)}
              type="button"
            >
              <span>{list.name}</span>
              <small>{list.taskIds.length}</small>
            </button>
          ))}
          {!viewer?.activeMember ? (
            <p className="empty">No authorized workspace.</p>
          ) : null}
        </nav>

        <article>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedListId || !draft.trim()) return;
              void createTask({ listId: selectedListId, title: draft.trim() });
              setDraft("");
            }}
          >
            <input
              aria-label="New task"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a task"
              value={draft}
            />
            <button type="submit">Add</button>
          </form>

          <ol>
            {tasks.map((task) => (
              <li
                data-completed={task.completed}
                data-position={task.position}
                data-revision={task.revision}
                data-task-id={task._id}
                key={task._id}
              >
                <input
                  aria-label={`Complete ${task.title}`}
                  checked={task.completed}
                  onChange={(event) =>
                    void updateTask({
                      taskId: task._id,
                      completed: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <input
                  aria-label={`Title ${task.title}`}
                  defaultValue={task.title}
                  key={`${task._id}:${task.revision}`}
                  onBlur={(event) => {
                    if (event.target.value !== task.title) {
                      void updateTask({
                        taskId: task._id,
                        title: event.target.value,
                      });
                    }
                  }}
                />
                <div className="task-actions">
                  <button
                    aria-label={`Move ${task.title} up`}
                    onClick={() =>
                      void moveTask({ taskId: task._id, direction: "up" })
                    }
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${task.title} down`}
                    onClick={() =>
                      void moveTask({ taskId: task._id, direction: "down" })
                    }
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`Delete ${task.title}`}
                    onClick={() => void deleteTask({ taskId: task._id })}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <main className="center-card">Loading Convex Auth…</main>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <TodoApp />
      </Authenticated>
    </>
  );
}
