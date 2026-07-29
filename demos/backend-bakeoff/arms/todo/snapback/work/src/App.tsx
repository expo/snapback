import { useMemo, useState } from 'react';

import { useSnapbackQuery } from '../../../../../../../packages/snapback-react/index.mjs';
import api from '../snapback/generated/api.mjs';
import {
  snapbackProvider,
  type Persona,
} from './provider';

type ListRow = {
  _id: string;
  name: string;
  position: number;
};

type TaskRow = {
  _id: string;
  _version: number;
  listId: string;
  title: string;
  completed: boolean;
  assigneeId: string;
  dueDate: string;
  position: number;
};

export function App({
  personas,
  primaryWorkspaceId,
}: {
  personas: Persona[];
  primaryWorkspaceId: string;
}) {
  const [personaId, setPersonaId] = useState<Persona['id']>('alice');
  const persona = personas.find((item) => item.id === personaId) ?? personas[0];
  const [selectedListId, setSelectedListId] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const lists = useSnapbackQuery<ListRow>({
    provider: snapbackProvider,
    query: api.listLists as any,
    args: { workspaceId: primaryWorkspaceId },
    userId: persona.id,
    authority: persona.id,
  });
  const tasks = useSnapbackQuery<TaskRow>({
    provider: snapbackProvider,
    query: api.listTasks as any,
    args: { workspaceId: primaryWorkspaceId },
    userId: persona.id,
    authority: persona.id,
  });

  const visibleTasks = useMemo(
    () => tasks.rows.filter((task: TaskRow) => task.listId === (selectedListId || lists.rows[0]?._id))
      .sort((a: TaskRow, b: TaskRow) => a.position - b.position || a._id.localeCompare(b._id)),
    [tasks.rows, lists.rows, selectedListId],
  );

  const mutate = async (name: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await snapbackProvider.mutate(name, args, persona.id);
    } finally {
      setBusy(false);
    }
  };

  const addTask = async () => {
    const title = draft.trim();
    if (!title) return;
    await mutate('createTask', {
      workspaceId: primaryWorkspaceId,
      listId: selectedListId || lists.rows[0]?._id,
      title,
      assigneeId: persona.userId,
      dueDate: '2026-08-31',
      position: visibleTasks.length,
    });
    setDraft('');
  };

  const connection = tasks.connection ?? lists.connection;
  const error = tasks.error ?? lists.error;

  return (
    <div className="app-frame" data-testid="todo-shell">
      <aside className="rail" aria-label="Bakeoff applications">
        <div className="mark" aria-hidden="true">SB</div>
        <button className="rail-button active" type="button">todo</button>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Calibration app · Snapback</p>
            <h1>Offline shared Todo</h1>
          </div>
          <div className="status-row">
            <span className={`status ${connection}`} data-testid="connection-state">
              {connection}
            </span>
            <label>
              Persona
              <select
                data-testid="persona-switcher"
                value={persona.id}
                onChange={(event) => setPersonaId(event.target.value as Persona['id'])}
              >
                {personas.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <section className="workspace two-column" aria-label="Todo workspace">
          <nav className="panel list-nav" aria-label="Task lists">
            <button className="primary" data-testid="todo-new-list" disabled>
              + New list
            </button>
            {lists.rows.map((list: ListRow) => (
              <button
                className={list._id === (selectedListId || lists.rows[0]?._id) ? 'nav-row selected' : 'nav-row'}
                key={list._id}
                onClick={() => setSelectedListId(list._id)}
                type="button"
              >
                {list.name} {tasks.rows.filter((task: TaskRow) => task.listId === list._id).length}
              </button>
            ))}
          </nav>
          <div className="panel content-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Shared workspace · {persona.name}</p>
                <h2>{lists.rows.find((list: ListRow) => list._id === (selectedListId || lists.rows[0]?._id))?.name ?? 'Tasks'}</h2>
              </div>
              <div className="add-row">
                <input
                  aria-label="New task title"
                  data-testid="todo-title-input"
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="What needs doing?"
                  value={draft}
                />
                <button
                  className="primary"
                  data-testid="todo-add-task"
                  disabled={busy || !draft.trim()}
                  onClick={addTask}
                  type="button"
                >
                  Add task
                </button>
              </div>
            </div>
            {error
              ? (
                <div className="error" data-testid="todo-access-denied">
                  {String((error as any)?.diagnostic?.code ?? (error as any)?.message ?? error)}
                </div>
              )
              : (
                <div className="task-table" role="table" aria-label="Tasks">
                  {visibleTasks.map((task: TaskRow, index: number) => (
                    <div className="task-row" role="row" data-testid={`todo-task-${task._id}`} key={task._id}>
                      <input
                        aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`}
                        checked={task.completed}
                        onChange={() => mutate('editTask', { id: task._id, completed: !task.completed })}
                        type="checkbox"
                      />
                      <div>
                        <input
                          aria-label={`Edit ${task.title}`}
                          className={task.completed ? 'task-title completed' : 'task-title'}
                          defaultValue={task.title}
                          onBlur={(event) => {
                            const title = event.target.value.trim();
                            if (title && title !== task.title) mutate('editTask', { id: task._id, title });
                          }}
                        />
                        <span>{task.assigneeId === persona.userId ? 'You' : 'Teammate'} · {task.dueDate}</span>
                      </div>
                      <button
                        aria-label={`Move ${task.title} up`}
                        disabled={index === 0 || busy}
                        onClick={() => mutate('reorderTask', { id: task._id, targetIndex: index - 1 })}
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Delete ${task.title}`}
                        disabled={busy}
                        onClick={() => mutate('deleteTask', { id: task._id })}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            <div className="offline-note" data-testid="todo-offline-state">
              {connection === 'live'
                ? 'All changes settled'
                : 'Online client only — membership-gated offline retention is unavailable'}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
