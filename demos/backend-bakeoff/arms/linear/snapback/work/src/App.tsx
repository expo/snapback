import { useEffect, useMemo, useState } from 'react';
import {
  subscribeIssues,
  updateIssue,
  type PersonaRuntime,
} from './provider';

export function App({ runtime }: { runtime: PersonaRuntime }) {
  const [personaId, setPersonaId] = useState<'alice' | 'bob' | 'mallory'>('alice');
  const [issues, setIssues] = useState<any[]>([]);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');
  const persona = runtime.personas.find((item) => item.id === personaId)!;

  useEffect(() => {
    let disposed = false;
    let handle: any;
    setIssues([]);
    setError('');
    subscribeIssues(persona, runtime.primaryOrganizationId, (rows, nextConnection) => {
      if (!disposed) {
        setIssues(rows);
        setConnection(nextConnection);
      }
    }).then((next) => { handle = next; }).catch((reason) => {
      if (!disposed) setError(reason?.diagnostic?.code ?? String(reason));
    });
    return () => {
      disposed = true;
      void handle?.dispose();
    };
  }, [persona, runtime.primaryOrganizationId]);

  const columns = useMemo(() => ['backlog', 'todo', 'in_progress', 'done'], []);
  const move = async (issue: any, status: string) => {
    const before = issues;
    setIssues((rows) => rows.map((row) => row._id === issue._id ? { ...row, status } : row));
    try {
      await updateIssue(persona, issue._id, { status });
    } catch (reason) {
      setIssues(before);
      setError(String(reason));
    }
  };

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">LLP 0102 · Snapback</span>
          <h1>Issue tracker</h1>
        </div>
        <label>Persona
          <select value={personaId} onChange={(event) => setPersonaId(event.target.value as any)}>
            {runtime.personas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <span data-testid="connection" className={`connection ${connection}`}>{connection}</span>
      </header>
      {error && <div className="error" data-testid="authority-error">{error}</div>}
      <section className="summary">
        <strong data-testid="issue-count">{issues.length}</strong> issues · indexed board views · native live updates
      </section>
      <section className="board" data-testid="issue-board">
        {columns.map((status) => (
          <article key={status}>
            <h2>{status.replace('_', ' ')}</h2>
            {issues.filter((issue) => issue.status === status).slice(0, 12).map((issue) => (
              <div className="card" key={issue._id} data-testid={`issue-${issue.sequence}`}>
                <small>{issue.identifier} · P{issue.priority}</small>
                <strong>{issue.title}</strong>
                <select aria-label={`Move ${issue.identifier}`} value={issue.status}
                  onChange={(event) => void move(issue, event.target.value)}>
                  {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                </select>
              </div>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}
