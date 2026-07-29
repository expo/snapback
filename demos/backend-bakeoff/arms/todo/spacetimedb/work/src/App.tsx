import { useMemo, useState } from 'react';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import './styles.css';

function App() {
  const connection = useSpacetimeDB();
  const [lists, listsReady] = useTable(tables.myLists);
  const [tasks, tasksReady] = useTable(tables.myTasks);
  const createTask = useReducer(reducers.createTask);
  const updateTask = useReducer(reducers.updateTask);
  const moveTask = useReducer(reducers.moveTask);
  const deleteTask = useReducer(reducers.deleteTask);
  const persona = new URLSearchParams(window.location.search).get('persona') ?? 'alice';
  const [selectedList, setSelectedList] = useState('list-1');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const visibleTasks = useMemo(
    () =>
      tasks
        .filter(task => task.listId === selectedList)
        .sort((left, right) => left.position - right.position),
    [selectedList, tasks]
  );

  const addTask = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || !connection.isActive) return;
    setBusy(true);
    try {
      await createTask({
        id: crypto.randomUUID(),
        listId: selectedList,
        title: nextTitle,
        assignee: 'alice',
        dueDate: '2026-08-31',
        position: visibleTasks.length,
      });
      setTitle('');
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (task: (typeof tasks)[number]) => {
    await updateTask({
      id: task.id,
      title: task.title,
      completed: !task.completed,
      assignee: task.assignee,
      dueDate: task.dueDate,
      listId: task.listId,
      position: task.position,
    });
  };

  const editTask = async (task: (typeof tasks)[number]) => {
    await updateTask({
      id: task.id,
      title: `${task.title.replace(/ · edited by .+$/, '')} · edited by ${persona}`,
      completed: task.completed,
      assignee: task.assignee,
      dueDate: task.dueDate,
      listId: task.listId,
      position: task.position,
    });
  };

  return (
    <div className="app-frame" data-testid="todo-shell">
      <aside className="rail">
        <div className="mark">ST</div>
        <p className="rail-label">SpacetimeDB</p>
        <p className="rail-copy">Generated bindings · transactional reducers · live views</p>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Calibration app</p>
            <h1>Offline shared Todo</h1>
          </div>
          <div className="status-row">
            <span className={connection.isActive ? 'status online' : 'status offline'} data-testid="connection-state">
              {connection.isActive ? 'Online' : 'Disconnected'}
            </span>
            <button
              className="avatar"
              aria-label="Disconnect current identity"
              data-testid="account-menu"
              onClick={() => {
                sessionStorage.setItem('llp0102-spacetimedb-signed-out', '1');
                connection.getConnection()?.disconnect();
              }}
            >
              A
            </button>
          </div>
        </header>

        <section className="workspace two-column" aria-label="Todo workspace">
          <nav className="panel list-nav" aria-label="Task lists">
            <button className="primary" data-testid="todo-new-list" disabled>
              Four frozen lists
            </button>
            {lists
              .slice()
              .sort((left, right) => left.position - right.position)
              .map(list => (
                <button
                  className={list.id === selectedList ? 'nav-row selected' : 'nav-row'}
                  key={list.id}
                  onClick={() => setSelectedList(list.id)}
                >
                  {list.title} <span>{tasks.filter(task => task.listId === list.id).length}</span>
                </button>
              ))}
          </nav>

          <div className="panel content-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Shared workspace</p>
                <h2>{lists.find(list => list.id === selectedList)?.title ?? 'Tasks'}</h2>
              </div>
              <div className="add-row">
                <input
                  aria-label="New task title"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void addTask();
                  }}
                  placeholder="New task"
                />
                <button className="primary" data-testid="todo-add-task" disabled={busy} onClick={() => void addTask()}>
                  Add task
                </button>
              </div>
            </div>

            <div className="task-table" role="table" aria-label="Tasks">
              {visibleTasks.map((task, index) => (
                <div
                  className="task-row"
                  role="row"
                  key={task.id}
                  data-testid={`todo-task-${index}`}
                  data-position={task.position}
                >
                  <button
                    className={task.completed ? 'check checked' : 'check'}
                    aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`}
                    onClick={() => void toggleTask(task)}
                  />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.assignee} · {task.dueDate} · revision {task.revision.toString()}</span>
                  </div>
                  <div className="task-actions">
                    <button aria-label={`Edit ${task.title}`} onClick={() => void editTask(task)}>Edit</button>
                    <button aria-label={`Move up ${task.title}`} onClick={() => void moveTask({ id: task.id, direction: 'up' })}>↑</button>
                    <button aria-label={`Move down ${task.title}`} onClick={() => void moveTask({ id: task.id, direction: 'down' })}>↓</button>
                    <button className="delete" aria-label={`Delete ${task.title}`} onClick={() => void deleteTask({ id: task.id })}>×</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="offline-note" data-testid="todo-offline-state">
              {!listsReady || !tasksReady
                ? 'Applying authorized subscriptions…'
                : `${tasks.length} authorized tasks in the live client cache`}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
