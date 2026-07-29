import { useEffect, useMemo, useRef, useState } from 'react';
import { DbConnection } from './module_bindings';

type IssueRow = ReturnType<DbConnection['db']['myIssues']['id']['find']>;

const DATABASE = 'llp0102-linear-spacetimedb-w1';
const URI = 'ws://127.0.0.1:3320';
const QUERIES = [
  'SELECT * FROM my_organizations',
  'SELECT * FROM my_teams',
  'SELECT * FROM my_projects',
  'SELECT * FROM my_labels',
  'SELECT * FROM my_issues',
  'SELECT * FROM my_issue_labels',
  'SELECT * FROM my_comments',
  'SELECT * FROM my_activities',
  'SELECT * FROM my_page_results',
];

export function App() {
  const connection = useRef<DbConnection | null>(null);
  const [state, setState] = useState<'connecting' | 'online' | 'authentication-required' | 'error'>('connecting');
  const [issues, setIssues] = useState<NonNullable<IssueRow>[]>([]);
  const [selectedId, setSelectedId] = useState('issue-001');
  const [pending, setPending] = useState<Record<string, NonNullable<IssueRow>>>({});
  const token = sessionStorage.getItem('linear-spacetimedb-token');

  useEffect(() => {
    if (!token) {
      setState('authentication-required');
      return;
    }
    let disposed = false;
    const refresh = (conn: DbConnection) => {
      if (disposed) return;
      setIssues(
        Array.from(conn.db.myIssues.iter())
          .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
          .slice(0, 50),
      );
    };
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DATABASE)
      .withToken(token)
      .withConfirmedReads(true)
      .onConnect((conn) => {
        if (disposed) {
          conn.disconnect();
          return;
        }
        connection.current = conn;
        conn.db.myIssues.onInsert(() => refresh(conn));
        conn.db.myIssues.onUpdate(() => refresh(conn));
        conn.db.myIssues.onDelete(() => refresh(conn));
        conn.subscriptionBuilder()
          .onApplied(() => {
            refresh(conn);
            setState('online');
          })
          .onError(() => setState('error'))
          .subscribe(QUERIES);
      })
      .onConnectError(() => setState('error'))
      .build();
    return () => {
      disposed = true;
      connection.current?.disconnect();
      connection.current = null;
    };
  }, [token]);

  const displayedIssues = useMemo(
    () => issues.map((row) => pending[row.id] ?? row),
    [issues, pending],
  );
  const selected = displayedIssues.find((row) => row.id === selectedId) ?? displayedIssues[0];

  const updateStatus = async (row: NonNullable<IssueRow>, status: string) => {
    const optimistic = { ...row, status };
    setPending((current) => ({ ...current, [row.id]: optimistic }));
    try {
      await connection.current?.reducers.updateIssue({
        issueId: row.id,
        expectedRevision: row.revision,
        status,
        priority: row.priority,
        assigneeName: row.assigneeName,
        boardPosition: row.boardPosition,
      });
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    }
  };

  return (
    <div className="app-frame" data-testid="linear-shell">
      <aside className="rail" aria-label="Bakeoff applications">
        <div className="mark" aria-hidden="true">SB</div>
        <button className="rail-button active" type="button">linear</button>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Deep app · SpacetimeDB 2.7.0</p>
            <h1>Issue tracker</h1>
          </div>
          <div className="status-row">
            <span className="status" data-testid="connection-state">
              {state === 'online' ? 'Online' : state.replaceAll('-', ' ')}
            </span>
            <button className="avatar" aria-label="Open account menu" data-testid="account-menu">A</button>
          </div>
        </header>
        <section className="workspace two-column" aria-label="Issue tracker">
          <nav className="panel list-nav" aria-label="Issue views">
            <button className="primary" data-testid="linear-new-issue">+ New issue</button>
            {['My issues', 'Inbox', 'Active', 'Backlog', 'Projects', 'Teams'].map((item, index) => (
              <button className={index === 2 ? 'nav-row selected' : 'nav-row'} key={item}>{item}</button>
            ))}
            <p className="gap-note" data-testid="linear-search-gap">
              Full-text search is an explicit provider GAP.
            </p>
          </nav>
          <div className="panel content-panel">
            <div className="section-heading">
              <div><p className="eyebrow">Platform team</p><h2>Active issues</h2></div>
              <input aria-label="Search issues" data-testid="linear-search" placeholder="Search unsupported" disabled />
            </div>
            {state === 'authentication-required' ? (
              <div className="empty-state">
                Set a development identity token in
                <code>sessionStorage["linear-spacetimedb-token"]</code>, then reload.
              </div>
            ) : (
              <div className="issue-layout">
                <div className="issue-list" data-testid="linear-issue-list">
                  {displayedIssues.map((row) => (
                    <button
                      className="issue-row"
                      key={row.id}
                      data-testid={`linear-issue-${row.identifier}`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <span className="muted">{row.identifier}</span>
                      <strong>{row.title}</strong>
                      <span className="pill">{row.status}</span>
                      <span>{row.assigneeName}</span>
                    </button>
                  ))}
                </div>
                {selected && (
                  <aside className="issue-detail" data-testid="linear-issue-detail">
                    <p className="eyebrow">{selected.identifier}</p>
                    <h3>{selected.title}</h3>
                    <p>{selected.description}</p>
                    <dl>
                      <dt>Status</dt><dd>{selected.status}</dd>
                      <dt>Priority</dt><dd>{selected.priority}</dd>
                      <dt>Assignee</dt><dd>{selected.assigneeName}</dd>
                      <dt>Impact</dt><dd>{selected.customerImpact}</dd>
                    </dl>
                    <div className="status-actions">
                      {['todo', 'in-progress', 'review', 'done'].map((status) => (
                        <button
                          key={status}
                          onClick={() => updateStatus(selected, status)}
                          type="button"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </aside>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
