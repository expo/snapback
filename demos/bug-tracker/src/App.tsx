import {
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQueries,
} from '@expo/snapback-react';
import { FormEvent, useMemo, useState } from 'react';
import api from '../snapback/generated/api.mjs';

const bugQueries = {
  bugs: { ref: api.listBugs, args: {} },
};

const statuses = ['open', 'in-progress', 'resolved'] as const;
type BugStatus = (typeof statuses)[number];
type Filter = BugStatus | 'all';

const statusLabels: Record<BugStatus, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  resolved: 'Resolved',
};

export function App() {
  const workspace = useSnapbackQueries(bugQueries);
  const createBug = useSnapbackMutation(api.createBug);
  const updateBugStatus = useSnapbackMutation(api.updateBugStatus);
  const connection = useSnapbackConnection();
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = workspace.queries.bugs;
  const bugs = query.status === 'ready' || query.status === 'refreshing' ? query.data : [];
  const visibleBugs = useMemo(
    () => filter === 'all' ? bugs : bugs.filter((bug) => bug.status === filter),
    [bugs, filter],
  );
  const counts = useMemo(() => ({
    all: bugs.length,
    open: bugs.filter((bug) => bug.status === 'open').length,
    'in-progress': bugs.filter((bug) => bug.status === 'in-progress').length,
    resolved: bugs.filter((bug) => bug.status === 'resolved').length,
  }), [bugs]);

  const submitBug = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await createBug({
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      setTitle('');
      setDescription('');
      setPriority('medium');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the bug.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeStatus = async (id: (typeof bugs)[number]['_id'], status: BugStatus) => {
    setError(null);
    try {
      await updateBugStatus({ id, status });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the bug.');
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bugboard home">
          <span className="brand-mark">B</span>
          <span>Bugboard</span>
        </a>
        <div className="connection" data-status={connection.status}>
          <span className="connection-dot" />
          {connection.status === 'live' ? 'Live' : connection.status}
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Product quality</p>
          <h1>Track the bugs.<br />Ship the fixes.</h1>
          <p className="hero-copy">A focused, live workspace for the issues standing between your team and a better release.</p>
        </div>
        <div className="stats" aria-label="Bug summary">
          <div><strong>{counts.open}</strong><span>Open</span></div>
          <div><strong>{counts['in-progress']}</strong><span>In progress</span></div>
          <div><strong>{counts.resolved}</strong><span>Resolved</span></div>
        </div>
      </section>

      <section className="workspace">
        <aside className="composer">
          <div className="section-heading">
            <span className="step">01</span>
            <div><h2>Report a bug</h2><p>Capture the problem while it’s fresh.</p></div>
          </div>
          <form onSubmit={submitBug}>
            <label>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="What went wrong?"
                maxLength={120}
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="Add the context someone needs to reproduce it…"
                rows={5}
              />
            </label>
            <label>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.currentTarget.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={isSubmitting || !title.trim()}>
              {isSubmitting ? 'Creating…' : 'Create bug'} <span>↗</span>
            </button>
            {error ? <p className="error" role="alert">{error}</p> : null}
          </form>
        </aside>

        <section className="issue-panel" aria-labelledby="issues-heading">
          <div className="section-heading issue-heading">
            <span className="step">02</span>
            <div><h2 id="issues-heading">Issues</h2><p>{bugs.length} across the workspace</p></div>
          </div>
          <nav className="filters" aria-label="Filter bugs">
            {(['all', ...statuses] as const).map((status) => (
              <button
                className={filter === status ? 'active' : ''}
                key={status}
                onClick={() => setFilter(status)}
              >
                {status === 'all' ? 'All' : statusLabels[status]} <span>{counts[status]}</span>
              </button>
            ))}
          </nav>

          {query.status === 'pending' ? <p className="empty-state">Opening the live issue list…</p> : null}
          {query.status === 'error' ? <p className="error" role="alert">The issue list could not be loaded.</p> : null}
          {query.status !== 'pending' && visibleBugs.length === 0 ? (
            <p className="empty-state">No bugs in this view. That’s a good-looking column.</p>
          ) : null}

          <div className="issue-list">
            {visibleBugs.map((bug) => (
              <article className="issue-card" key={bug._id}>
                <div className="issue-copy">
                  <div className="issue-meta">
                    <span className={`priority priority-${bug.priority}`}>{bug.priority}</span>
                    <span>#{bug._id.slice(-6).toUpperCase()}</span>
                  </div>
                  <h3>{bug.title}</h3>
                  <p>{bug.description || 'No description provided.'}</p>
                </div>
                <label className="status-control">
                  <span>Status</span>
                  <select
                    value={bug.status}
                    onChange={(event) => void changeStatus(bug._id, event.currentTarget.value as BugStatus)}
                    aria-label={`Status for ${bug.title}`}
                  >
                    {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                  </select>
                </label>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
