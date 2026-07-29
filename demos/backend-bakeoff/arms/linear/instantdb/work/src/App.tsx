import { useEffect, useState } from 'react';
import { init } from '@instantdb/react';
import schema from '../instant.schema';

const appId = import.meta.env.VITE_INSTANT_APP_ID;
if (!appId) throw new Error('VITE_INSTANT_APP_ID is required');
const db = init({ appId, schema });

type Issue = {
  id: string;
  issueNumber: number;
  title: string;
  status: string;
  priority: string;
  assigneeId?: string;
  boardPosition: number;
  revision: number;
};

function Tracker({ userId }: { userId: string }) {
  const connection = db.useConnectionStatus();
  const query = db.useQuery({
    issues: {
      $: { first: 50, order: { createdOrder: 'desc' } },
      project: {},
      labels: {},
    },
  });
  const [settlement, setSettlement] = useState('All changes settled');
  const issues = (query.data?.issues ?? []) as Issue[];

  function setStatus(issue: Issue, status: string) {
    setSettlement(connection === 'authenticated' ? 'Saving…' : 'Queued offline');
    void db
      .transact(
        db.tx.issues[issue.id].update({
          status,
          revision: issue.revision + 1,
          moveNonce: `ui-${crypto.randomUUID()}`,
          updatedAt: new Date(),
        }),
      )
      .then((result) =>
        setSettlement(result.status === 'enqueued' ? 'Queued offline' : 'All changes settled'),
      )
      .catch((error) =>
        setSettlement(error instanceof Error ? error.message : 'Write failed'),
      );
  }

  return (
    <div
      className="frame"
      data-testid="linear-shell"
      data-ready={!query.isLoading}
      data-user-id={userId}
      data-issue-count={issues.length}
      data-connection={connection}
    >
      <aside className="rail">
        <div className="mark">ID</div>
        <strong>Linear</strong>
        <span>InstantDB arm</span>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">Deep-round app · InstantDB</p>
            <h1>Issue tracker</h1>
          </div>
          <span data-testid="connection-state">{connection}</span>
        </header>
        <section className="workspace">
          <div className="panel conversation">
            <div className="heading">
              <div>
                <p className="eyebrow">Primary organization</p>
                <h2>Issues</h2>
              </div>
              <span>{issues.length} loaded</span>
            </div>
            {query.error ? <p role="alert">{query.error.message}</p> : null}
            <ol className="messages" aria-label="Issues">
              {issues.map((issue) => (
                <li
                  data-issue-id={issue.id}
                  data-status={issue.status}
                  key={issue.id}
                >
                  <strong>LIN-{issue.issueNumber}</strong>
                  <span>{issue.title}</span>
                  <select
                    aria-label={`Status LIN-${issue.issueNumber}`}
                    onChange={(event) => setStatus(issue, event.target.value)}
                    value={issue.status}
                  >
                    <option value="backlog">Backlog</option>
                    <option value="todo">Todo</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                  </select>
                </li>
              ))}
            </ol>
            <div data-testid="linear-offline-state">{settlement}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export function App() {
  const { user } = db.useAuth();
  const token = new URLSearchParams(location.search).get('token');

  useEffect(() => {
    if (!user && token) void db.auth.signInWithToken(token);
  }, [token, user]);

  if (!user) {
    return (
      <main className="signin" data-testid="linear-shell">
        <p>Signing in with the arm-scoped native guest identity…</p>
      </main>
    );
  }
  return <Tracker userId={user.id} />;
}
