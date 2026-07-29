import { useEffect, useState } from "react";
import { api, clientFor, type Runtime } from "./provider";

export function App({ runtime }: { runtime: Runtime }) {
  const [personaId, setPersonaId] = useState<"alice" | "bob" | "mallory">("alice");
  const [issues, setIssues] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    setIssues([]);
    setError("");
    clientFor(runtime, personaId).then((client) => {
      if (disposed) return;
      unsubscribe = client.onUpdate(
        api.linear.listIssues,
        { organizationId: runtime.primaryOrganizationId as any },
        (rows: any[]) => {
          if (!disposed) {
            setIssues(rows);
            setLive(true);
          }
        },
        (reason: unknown) => {
          if (!disposed) setError(String(reason));
        },
      );
    }).catch((reason) => setError(String(reason)));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [personaId, runtime]);

  const columns = ["backlog", "todo", "in_progress", "done"];
  return <main>
    <header>
      <div><small>LLP 0102 · Convex</small><h1>Issue tracker</h1></div>
      <select value={personaId} onChange={(event) => setPersonaId(event.target.value as any)}>
        {runtime.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
      </select>
      <span data-testid="connection">{live ? "live" : "connecting"}</span>
    </header>
    {error && <div data-testid="authority-error" className="error">{error}</div>}
    <p><strong data-testid="issue-count">{issues.length}</strong> issues</p>
    <section className="board">
      {columns.map((status) => <article key={status}>
        <h2>{status.replace("_", " ")}</h2>
        {issues.filter((issue) => issue.status === status).slice(0, 12).map((issue) =>
          <div className="card" key={issue._id}>
            <small>{issue.identifier} · P{issue.priority}</small>
            <strong>{issue.title}</strong>
          </div>)}
      </article>)}
    </section>
  </main>;
}
