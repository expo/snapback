import { FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  BackendAdapter,
  BackendKind,
  IncidentStatus,
  Persona,
  Presence,
  Severity,
  WorkspaceSnapshot,
} from './types';
import { PERSONAS } from './types';

const EMPTY: WorkspaceSnapshot = { incidents: [], tasks: [], comments: [], activity: [] };
const BACKENDS: Array<{ kind: BackendKind; label: string; note: string }> = [
  { kind: 'snapback', label: 'Snapback', note: 'Local native runtime' },
  { kind: 'convex', label: 'Convex', note: 'Reactive functions' },
  { kind: 'supabase', label: 'Supabase', note: 'Postgres + Realtime' },
];

const person = (id: string) => PERSONAS.find((item) => item.id === id) ?? PERSONAS[0];
const clock = (time: number) =>
  new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(time);

function Avatar({ persona, tiny = false }: { persona: Persona; tiny?: boolean }) {
  return (
    <span
      className={tiny ? 'avatar avatar--tiny' : 'avatar'}
      style={{ background: persona.color }}
      title={persona.name}
    >
      {persona.initials}
    </span>
  );
}

export function App({
  backend,
  kind,
}: {
  backend: BackendAdapter;
  kind: BackendKind;
}) {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState('');
  const [persona, setPersona] = useState(PERSONAS[0]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [search, setSearch] = useState('');
  const [searchIds, setSearchIds] = useState<string[] | null>(null);
  const [taskBody, setTaskBody] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    let off = () => {};
    void backend
      .subscribeWorkspace((next) => {
        if (disposed) return;
        setSnapshot(next);
        setSelectedId((current) => current || next.incidents[0]?.id || '');
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        off = dispose;
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause?.message ?? cause));
      });
    return () => {
      disposed = true;
      off();
    };
  }, [backend]);

  useEffect(() => {
    if (!selectedId) return;
    let disposed = false;
    let off = () => {};
    setPresence([]);
    void backend
      .subscribePresence(selectedId, persona, (next) => {
        if (!disposed) setPresence(next);
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        off = dispose;
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause?.message ?? cause));
      });
    return () => {
      disposed = true;
      off();
    };
  }, [backend, selectedId, persona]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchIds(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void backend
        .searchIncidents(search)
        .then((rows) => {
          if (alive) setSearchIds(rows.map((row) => row.id));
        })
        .catch((cause) => setError(String(cause?.message ?? cause)));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [backend, search]);

  const incidents = useMemo(
    () =>
      searchIds === null
        ? snapshot.incidents
        : snapshot.incidents.filter((item) => searchIds.includes(item.id)),
    [snapshot.incidents, searchIds],
  );
  const selected =
    snapshot.incidents.find((incident) => incident.id === selectedId) ?? snapshot.incidents[0];
  const tasks = snapshot.tasks
    .filter((task) => task.incidentId === selected?.id)
    .sort((a, b) => a.position - b.position);
  const comments = snapshot.comments
    .filter((comment) => comment.incidentId === selected?.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const activity = snapshot.activity
    .filter((item) => item.incidentId === selected?.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const done = tasks.filter((task) => task.completed).length;

  const act = async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await operation();
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    } finally {
      setBusy('');
    }
  };

  const changeBackend = (next: BackendKind) => {
    const url = new URL(location.href);
    url.searchParams.set('backend', next);
    location.href = url.toString();
  };

  if (!selected) {
    return <main className="boot">Waiting for the first live snapshot…</main>;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">S/</span>
          <div>
            <strong>Signal Desk</strong>
            <small>Backend bakeoff</small>
          </div>
        </div>
        <nav className="backend-tabs" aria-label="Backend">
          {BACKENDS.map((item) => (
            <button
              key={item.kind}
              className={kind === item.kind ? 'backend-tab backend-tab--active' : 'backend-tab'}
              onClick={() => changeBackend(item.kind)}
              data-testid={`backend-${item.kind}`}
            >
              <span>{item.label}</span>
              <small>{item.note}</small>
            </button>
          ))}
        </nav>
        <div className="persona">
          <span className="live-dot" />
          <select
            aria-label="Persona"
            value={persona.id}
            onChange={(event) => setPersona(person(event.target.value))}
          >
            {PERSONAS.map((item) => (
              <option key={item.id} value={item.id}>
                Acting as {item.name}
              </option>
            ))}
          </select>
          <Avatar persona={persona} />
        </div>
      </header>

      <aside className="rail">
        <div className="rail__top">
          <label className="search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search incidents"
              data-testid="search"
            />
          </label>
          <button className="new-button" onClick={() => setNewOpen(true)} data-testid="new-incident">
            + New
          </button>
        </div>
        <div className="rail__label">
          <span>Active incidents</span>
          <em>{incidents.filter((item) => item.status !== 'resolved').length}</em>
        </div>
        <div className="incident-list">
          {incidents.map((incident) => (
            <button
              key={incident.id}
              className={incident.id === selected.id ? 'incident-row incident-row--active' : 'incident-row'}
              onClick={() => {
                setSelectedId(incident.id);
                setBrief('');
              }}
              data-testid={`incident-${incident.id}`}
            >
              <span className={`severity severity--${incident.severity.slice(-1)}`}>
                {incident.severity}
              </span>
              <strong>{incident.title}</strong>
              <small>{incident.status}</small>
              <time>{clock(incident.updatedAt)}</time>
            </button>
          ))}
        </div>
        <div className="transport">
          <span className="live-dot" />
          <div>
            <strong>{backend.label} live</strong>
            <small>{backend.transport}</small>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <section className="incident-head">
          <div>
            <div className="eyebrow">
              <span className={`severity severity--${selected.severity.slice(-1)}`}>
                {selected.severity}
              </span>
              <span>INC-{selected.id.slice(-4).toUpperCase()}</span>
              <span>Opened {clock(selected.createdAt)}</span>
            </div>
            <h1>{selected.title}</h1>
            <p>{selected.summary}</p>
          </div>
          <div className="head-actions">
            <div className="presence" aria-label="Current viewers">
              {presence.slice(0, 4).map((entry) => (
                <Avatar
                  key={entry.key}
                  tiny
                  persona={{
                    id: entry.userId,
                    name: entry.name,
                    initials: entry.name.slice(0, 2).toUpperCase(),
                    color: entry.color,
                  }}
                />
              ))}
              <small>{presence.length || 1} viewing</small>
            </div>
            <select
              value={selected.status}
              disabled={Boolean(busy)}
              onChange={(event) =>
                void act('status', () =>
                  backend.setStatus({
                    actorId: persona.id,
                    incidentId: selected.id,
                    status: event.target.value as IncidentStatus,
                  }),
                )
              }
              data-testid="status"
            >
              <option value="investigating">Investigating</option>
              <option value="monitoring">Monitoring</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </section>

        {error && <div className="error" role="alert">{error}</div>}
        {brief && (
          <section className="brief" data-testid="brief">
            <span>Generated handoff</span>
            <p>{brief}</p>
            <button onClick={() => setBrief('')}>×</button>
          </section>
        )}

        <div className="columns">
          <div className="primary-column">
            <section className="panel">
              <div className="panel__title">
                <div>
                  <span>Response checklist</span>
                  <strong>{done}/{tasks.length} complete</strong>
                </div>
                <div className="progress"><i style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
              </div>
              <div className="tasks">
                {tasks.map((taskItem) => (
                  <label key={taskItem.id} className={taskItem.completed ? 'task task--done' : 'task'}>
                    <input
                      type="checkbox"
                      checked={taskItem.completed}
                      onChange={(event) => {
                        const completed = event.target.checked;
                        const previous = taskItem.completed;
                        setSnapshot((current) => ({
                          ...current,
                          tasks: current.tasks.map((row) =>
                            row.id === taskItem.id ? { ...row, completed } : row,
                          ),
                        }));
                        void act('task', async () => {
                          try {
                            await backend.toggleTask({
                              actorId: persona.id,
                              incidentId: selected.id,
                              taskId: taskItem.id,
                              completed,
                            });
                          } catch (cause) {
                            setSnapshot((current) => ({
                              ...current,
                              tasks: current.tasks.map((row) =>
                                row.id === taskItem.id ? { ...row, completed: previous } : row,
                              ),
                            }));
                            throw cause;
                          }
                        });
                      }}
                      data-testid={`task-${taskItem.id}`}
                    />
                    <span>{taskItem.body}</span>
                    <Avatar persona={person(taskItem.assigneeId)} tiny />
                  </label>
                ))}
              </div>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskBody.trim()) return;
                  const body = taskBody;
                  setTaskBody('');
                  void act('add-task', () =>
                    backend.addTask({ actorId: persona.id, incidentId: selected.id, body }),
                  );
                }}
              >
                <input
                  value={taskBody}
                  onChange={(event) => setTaskBody(event.target.value)}
                  placeholder="Add a response task…"
                  data-testid="task-input"
                />
                <button disabled={!taskBody.trim() || Boolean(busy)}>Add task</button>
              </form>
            </section>

            <section className="panel">
              <div className="panel__title panel__title--plain">
                <span>Field notes</span>
                <strong>{comments.length}</strong>
              </div>
              <div className="comments">
                {comments.map((item) => {
                  const author = person(item.authorId);
                  return (
                    <article key={item.id} className="comment">
                      <Avatar persona={author} />
                      <div>
                        <strong>{author.name}</strong>
                        <time>{clock(item.createdAt)}</time>
                        <p>{item.body}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
              <form
                className="comment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!commentBody.trim()) return;
                  const body = commentBody;
                  setCommentBody('');
                  void act('comment', () =>
                    backend.addComment({ actorId: persona.id, incidentId: selected.id, body }),
                  );
                }}
              >
                <Avatar persona={persona} />
                <input
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Share an observation or decision…"
                  data-testid="comment-input"
                />
                <button disabled={!commentBody.trim() || Boolean(busy)}>Post</button>
              </form>
            </section>
          </div>

          <aside className="side-column">
            <section className="panel facts">
              <div className="panel__title panel__title--plain"><span>Incident facts</span></div>
              <dl>
                <div><dt>Commander</dt><dd><Avatar persona={person(selected.commanderId)} tiny /> {person(selected.commanderId).name}</dd></div>
                <div><dt>Backend</dt><dd>{backend.label}</dd></div>
                <div><dt>Live viewers</dt><dd>{presence.length || 1}</dd></div>
                <div><dt>Last update</dt><dd>{clock(selected.updatedAt)}</dd></div>
              </dl>
              <button
                className="brief-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act('brief', async () => {
                    setBrief(await backend.generateBrief(selected.id));
                  })
                }
                data-testid="generate-brief"
              >
                ✦ Generate handoff brief
              </button>
            </section>
            <section className="panel">
              <div className="panel__title panel__title--plain">
                <span>Activity</span><strong>Live</strong>
              </div>
              <ol className="timeline">
                {activity.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <i />
                    <div>
                      <strong>{item.kind.replace('.', ' ')}</strong>
                      <p>{item.detail}</p>
                      <small>{person(item.actorId).name} · {clock(item.createdAt)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </main>

      {newOpen && (
        <NewIncident
          persona={persona}
          onClose={() => setNewOpen(false)}
          onCreate={(title, severity) =>
            act('new', async () => {
              const id = await backend.createIncident({ actorId: persona.id, title, severity });
              setSelectedId(id);
              setNewOpen(false);
            })
          }
        />
      )}
    </div>
  );
}

function NewIncident({
  persona,
  onClose,
  onCreate,
}: {
  persona: Persona;
  onClose: () => void;
  onCreate: (title: string, severity: Severity) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('SEV-2');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim()) void onCreate(title, severity);
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <span className="eyebrow">Open an incident</span>
        <h2>What needs the team?</h2>
        <label>Incident title<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Severity<select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
          <option>SEV-1</option><option>SEV-2</option><option>SEV-3</option>
        </select></label>
        <p><Avatar persona={persona} tiny /> {persona.name} will be incident commander.</p>
        <div><button type="button" onClick={onClose}>Cancel</button><button className="new-button" disabled={!title.trim()}>Open incident</button></div>
      </form>
    </div>
  );
}
